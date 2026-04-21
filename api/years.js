// years.js
// RLS가 해제된 환경 기준으로 단순화.
// JWT 검증 실패 시에도 sessionStorage의 status를 body로 받아 처리.
// exam_date: int4 8자리 (20190601) → 앞 4자리(2019) 추출.

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// int4 값(20190601 또는 2019) → "2019"
function toYear(val) {
  if (val === null || val === undefined) return null;
  const n = Number(val);
  if (isNaN(n) || n <= 0) return null;
  // 8자리 이상: YYYYMMDD 형태
  const y = n >= 10000000 ? Math.floor(n / 10000) : n;
  if (y < 1900 || y > 2100) return null;
  return String(y);
}

// 뷰 또는 테이블 행 배열 → 연도 문자열 배열
function extractYears(rows) {
  return rows
    .map(row => {
      const val = row.exam_date ?? row.year ?? Object.values(row)[0];
      return toYear(val);
    })
    .filter(Boolean);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method Not Allowed' });
  }

  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');

  // ── 권한 판단 ───────────────────────────────────────────
  // 1순위: Authorization 헤더 JWT 검증
  // 2순위: body.userStatus (JWT 없을 때 폴백 — 보안보다 가용성 우선)
  let userStatus = 'free';

  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    try {
      const { data: { user }, error } = await supabase.auth.getUser(token);
      if (!error && user) {
        const { data: profile } = await supabase
          .from('users')
          .select('user_status, expiry_date')
          .eq('id', user.id)
          .single();

        if (profile) {
          userStatus = profile.user_status || 'free';
          // 만료 체크
          if (userStatus === 'premium' && profile.expiry_date) {
            if (new Date(profile.expiry_date) < new Date()) userStatus = 'free';
          }
          console.log('[years.js] JWT 검증 성공 → userStatus:', userStatus);
        }
      } else {
        console.warn('[years.js] JWT 검증 실패:', error?.message);
      }
    } catch (e) {
      console.warn('[years.js] JWT 검증 예외:', e.message);
    }
  }

  // JWT 없거나 실패 시 body.userStatus 폴백
  if (!authHeader && req.body?.userStatus) {
    userStatus = req.body.userStatus;
    console.log('[years.js] body.userStatus 폴백:', userStatus);
  }

  console.log('[years.js] 최종 userStatus:', userStatus);

  try {
    let years = [];

    // ── 뷰 이름 결정 ────────────────────────────────────
    const viewName = userStatus === 'admin'
      ? 'unique_years'
      : userStatus === 'premium'
        ? 'unique_years_premium'
        : 'unique_years_free';

    // ── 1차: 뷰 조회 ────────────────────────────────────
    const { data: viewData, error: viewError } = await supabase
      .from(viewName)
      .select('*');

    if (!viewError && viewData?.length > 0) {
      console.log(`[years.js] 뷰 "${viewName}" 성공, 건수:`, viewData.length, '샘플:', viewData.slice(0, 3));
      years = extractYears(viewData);
    } else {
      // ── 2차: questions 직접 쿼리 폴백 ──────────────────
      if (viewError) {
        console.warn(`[years.js] 뷰 "${viewName}" 오류:`, viewError.message, viewError.code);
      } else {
        console.warn(`[years.js] 뷰 "${viewName}" 결과 없음 → 직접 쿼리 폴백`);
      }

      let q = supabase.from('questions').select('exam_date');
      if (userStatus === 'free')    q = q.eq('is_premium', false);
      if (userStatus === 'premium') q = q.eq('is_verified', true);

      const { data: qData, error: qError } = await q;
      if (qError) {
        console.error('[years.js] 직접 쿼리 오류:', qError.message);
        throw qError;
      }
      console.log('[years.js] 직접 쿼리 건수:', qData?.length, '샘플:', qData?.slice(0, 3));
      years = extractYears(qData || []);
    }

    // 중복 제거 + 내림차순 정렬
    const result = [...new Set(years)].sort((a, b) => Number(b) - Number(a));
    console.log('[years.js] 최종 응답 연도 목록:', result);

    return res.status(200).json(result);

  } catch (error) {
    console.error('[years.js] 핸들러 오류:', error.message);
    return res.status(500).json({ message: error.message });
  }
}
