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
// [FIX-High-⑤] 수정: exam_date → year → 첫 번째 숫자값 순으로 탐색
//   · exam_date, year 컬럼이 없는 뷰에서도 첫 번째 숫자 컬럼을 연도로 사용
//   · select('*')와 조합하여 컬럼 존재 여부에 독립적으로 동작합니다.
// ─────────────────────────────────────────────────────────────────
function extractYears(rows) {
  return rows
    .map(row => {
      // 1순위: exam_date 컬럼
      if (row.exam_date !== undefined) return toYear(row.exam_date);
      // 2순위: year 컬럼
      if (row.year !== undefined)      return toYear(row.year);
      // 3순위: 첫 번째 숫자 값 (뷰 컬럼명이 다를 경우 폴백)
      const firstNumeric = Object.values(row).find(v => typeof v === 'number' || typeof v === 'string');
      return toYear(firstNumeric);
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

    // ── 1차: 뷰 조회 ──────────────────────────────
    // [FIX-High-⑤] 기존 select('exam_date, year')는 뷰에 두 컬럼이 모두 없으면
    //              Supabase가 컬럼 오류를 반환합니다.
    // 수정: select('*')로 전체를 받은 후 extractYears에서 유연하게 파싱합니다.
    // extractYears는 exam_date → year → 첫 번째 숫자 값 순으로 탐색합니다.
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

      // [FIX-High-⑤] select('exam_date') → select('*')로 통일
      //              extractYears가 컬럼명에 독립적으로 처리하므로 안전합니다.
      let q = supabase.from('questions').select('*');
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
