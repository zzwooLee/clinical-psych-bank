// years.js
// [SEC-1] body.userStatus 폴백 완전 제거
//         JWT 검증 실패 시 무조건 401 반환 → userStatus 위조 불가
// [SEC-2] premium 만료 체크 로직 유지
// exam_date: int4 8자리 (20190601) → 앞 4자리(2019) 추출

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// ─────────────────────────────────────────────────────────────────
// JWT 검증 헬퍼
// · 성공 시 { id, user_status } 반환
// · 실패 시 null 반환 — 절대 throw 안 함
// ─────────────────────────────────────────────────────────────────
async function verifyUser(req) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) return null;

    const token = authHeader.split(' ')[1];

    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) {
      console.warn('[years.js] JWT 검증 실패:', error?.message);
      return null;
    }

    const { data: profile, error: profileError } = await supabase
      .from('users')
      .select('user_status, expiry_date')
      .eq('id', user.id)
      .single();

    if (profileError || !profile) {
      console.warn('[years.js] users 조회 실패:', profileError?.message);
      return null;
    }

    // premium 만료 체크
    let userStatus = profile.user_status || 'free';
    if (userStatus === 'premium' && profile.expiry_date) {
      if (new Date(profile.expiry_date) < new Date()) {
        console.log('[years.js] premium 만료 → free 처리:', user.id);
        userStatus = 'free';
        // 비동기 다운그레이드 (결과 무시)
        supabase
          .from('users')
          .update({ user_status: 'free' })
          .eq('id', user.id)
          .then(() => {})
          .catch(() => {});
      }
    }

    console.log('[years.js] JWT 검증 성공 → userStatus:', userStatus);
    return { id: user.id, user_status: userStatus };
  } catch (e) {
    console.warn('[years.js] verifyUser 예외:', e.message);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────
// int4 값(20190601 또는 2019) → "2019"
// ─────────────────────────────────────────────────────────────────
function toYear(val) {
  if (val === null || val === undefined) return null;
  const n = Number(val);
  if (isNaN(n) || n <= 0) return null;
  // 8자리 이상: YYYYMMDD 형태
  const y = n >= 10000000 ? Math.floor(n / 10000) : n;
  if (y < 1900 || y > 2100) return null;
  return String(y);
}

// ─────────────────────────────────────────────────────────────────
// 뷰 또는 테이블 행 배열 → 연도 문자열 배열
// ─────────────────────────────────────────────────────────────────
function extractYears(rows) {
  return rows
    .map(row => {
      const val = row.exam_date ?? row.year ?? Object.values(row)[0];
      return toYear(val);
    })
    .filter(Boolean);
}

// ─────────────────────────────────────────────────────────────────
// 핸들러
// ─────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method Not Allowed' });
  }

  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');

  // ── [SEC-1] 권한 판단: JWT만 신뢰, body 값 일절 사용 안 함 ────
  const verified = await verifyUser(req);
  if (!verified) {
    console.warn('[years.js] 인증 실패 → 401 반환');
    return res.status(401).json({ message: '세션이 만료되었습니다. 다시 로그인해주세요.' });
  }

  const userStatus = verified.user_status;
  console.log('[years.js] 최종 userStatus:', userStatus);

  try {
    let years = [];

    // ── 뷰 이름 결정 ──────────────────────────────────────────
    const viewName = userStatus === 'admin'
      ? 'unique_years'
      : userStatus === 'premium'
        ? 'unique_years_premium'
        : 'unique_years_free';

    // ── 1차: 뷰 조회 ──────────────────────────────────────────
    const { data: viewData, error: viewError } = await supabase
      .from(viewName)
      .select('*');

    if (!viewError && viewData?.length > 0) {
      console.log(
        `[years.js] 뷰 "${viewName}" 성공, 건수:`, viewData.length,
        '샘플:', viewData.slice(0, 3)
      );
      years = extractYears(viewData);
    } else {
      // ── 2차: questions 직접 쿼리 폴백 ────────────────────────
      if (viewError) {
        console.warn(`[years.js] 뷰 "${viewName}" 오류:`, viewError.message, viewError.code);
      } else {
        console.warn(`[years.js] 뷰 "${viewName}" 결과 없음 → 직접 쿼리 폴백`);
      }

      let q = supabase.from('questions').select('exam_date');
      if (userStatus === 'free')    q = q.eq('is_premium', false);
      if (userStatus === 'premium') q = q.eq('is_verified', true);
      // admin: 필터 없음

      const { data: qData, error: qError } = await q;
      if (qError) {
        console.error('[years.js] 직접 쿼리 오류:', qError.message);
        throw qError;
      }
      console.log(
        '[years.js] 직접 쿼리 건수:', qData?.length,
        '샘플:', qData?.slice(0, 3)
      );
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
