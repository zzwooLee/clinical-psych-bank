// years.js
// [FIX-1] extractYears: Object.values(row)[0] 취약성 수정
//         → row.exam_date || row.year 만 사용, 컬럼 순서 의존성 제거
// [FIX-2] 뷰/직접 쿼리 모두 exam_date 컬럼을 명시적으로 select
// [SEC-1] body.userStatus 폴백 완전 제거 — JWT 검증 실패 시 401 반환
// [SEC-2] premium 만료 체크 로직 유지

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// ─────────────────────────────────────────────────────────────────
// JWT 검증 헬퍼
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

    let userStatus = profile.user_status || 'free';
    if (userStatus === 'premium' && profile.expiry_date) {
      if (new Date(profile.expiry_date) < new Date()) {
        console.log('[years.js] premium 만료 → free 처리:', user.id);
        userStatus = 'free';
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
  const y = n >= 10000000 ? Math.floor(n / 10000) : n;
  if (y < 1900 || y > 2100) return null;
  return String(y);
}

// ─────────────────────────────────────────────────────────────────
// [FIX-1] 뷰 또는 테이블 행 배열 → 연도 문자열 배열
// 기존: Object.values(row)[0] → 컬럼 순서 변경 시 잘못된 값 반환
// 수정: row.exam_date, row.year 순으로 명시적으로 접근
// ─────────────────────────────────────────────────────────────────
function extractYears(rows) {
  return rows
    .map(row => {
      // exam_date 우선, 없으면 year 컬럼 사용
      // Object.values(row)[0] 방식 제거 → 컬럼 순서에 독립적
      const val = row.exam_date !== undefined ? row.exam_date : row.year;
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

  const verified = await verifyUser(req);
  if (!verified) {
    console.warn('[years.js] 인증 실패 → 401 반환');
    return res.status(401).json({ message: '세션이 만료되었습니다. 다시 로그인해주세요.' });
  }

  const userStatus = verified.user_status;
  console.log('[years.js] 최종 userStatus:', userStatus);

  try {
    let years = [];

    const viewName = userStatus === 'admin'
      ? 'unique_years'
      : userStatus === 'premium'
        ? 'unique_years_premium'
        : 'unique_years_free';

    // ── 1차: 뷰 조회 (exam_date 컬럼 명시적 select) ──────────
    // [FIX-2] select('*') 대신 select('exam_date') 명시
    //         뷰에 year 컬럼만 있는 경우를 위해 fallback으로 select('*') 유지
    const { data: viewData, error: viewError } = await supabase
      .from(viewName)
      .select('exam_date, year');  // 두 컬럼 모두 시도 — 없는 컬럼은 undefined로 반환됨

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

      // [FIX-2] select('exam_date') 명시 — select('*') 불필요한 컬럼 제거
      let q = supabase.from('questions').select('exam_date');
      if (userStatus === 'free')    q = q.eq('is_premium', false);
      if (userStatus === 'premium') q = q.eq('is_verified', true);

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

    const result = [...new Set(years)].sort((a, b) => Number(b) - Number(a));
    console.log('[years.js] 최종 응답 연도 목록:', result);

    return res.status(200).json(result);

  } catch (error) {
    console.error('[years.js] 핸들러 오류:', error.message);
    return res.status(500).json({ message: error.message });
  }
}
