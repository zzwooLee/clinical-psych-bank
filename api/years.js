// years.js
// ─────────────────────────────────────────────────────────────────
// 수정 이력
// [FIX-High-1] premium 만료 처리 fire-and-forget → await + 실패 로그
//              기존 .then(()=>{}).catch(()=>{}) 패턴은 업데이트 실패 시
//              아무 흔적도 남기지 않아 만료 후에도 premium 접근이 허용될 수 있었음
// [기존 유지]  extractYears: exam_date → year → 첫 번째 숫자값 순으로 탐색
// [기존 유지]  body.userStatus 폴백 완전 제거 — JWT 검증 실패 시 401 반환
// [기존 유지]  select('*') 유연 파싱 (컬럼명 독립)
// [NEW-1] grade 파라미터 수신 — premium 유저에게 급수별 연도 필터링 적용
//         unique_years_premium 뷰는 explanation 완전성 조건을 포함하므로
//         grade가 주어지면 뷰 결과를 grade로 추가 필터링합니다.
//         free / admin 유저는 grade 파라미터를 무시하고 기존 동작을 유지합니다.
// [NEW-2] premium 유저 뷰 0건 시 폴백 금지
//         뷰가 정상 동작했으나 결과가 0건인 경우는 "해당 조건을 충족하는 연도 없음"
//         이므로 빈 배열을 즉시 반환합니다. 폴백으로 넘어가면 explanation 완전성
//         조건을 우회하여 의도하지 않은 연도가 표시될 수 있습니다.
// [FIX-2025-3] free 유저 연도 필터 완전 차단
//              변경 전: unique_years_free 뷰로 연도 목록 제공
//              변경 후: free 유저는 빈 배열 즉시 반환 → 연도 select 비활성화
// [FIX-2025-4] premium 폴백 쿼리 조건 수정
//              변경 전: explanation IS NOT NULL + 자료 외 정보 제외
//              변경 후: is_premium=TRUE AND explanation IS NOT NULL (questions.js와 일치)
// ─────────────────────────────────────────────────────────────────

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
        console.log('[years.js] premium 만료 → free 처리 시작:', user.id);
        userStatus = 'free';
        // [FIX-High-1] fire-and-forget → await + 실패 로그
        const { error: downgradeErr } = await supabase
          .from('users')
          .update({ user_status: 'free' })
          .eq('id', user.id);
        if (downgradeErr) {
          console.error('[years.js] premium 만료 처리 DB 업데이트 실패:', downgradeErr.message);
        } else {
          console.log('[years.js] premium 만료 → free 처리 완료:', user.id);
        }
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
// 뷰 또는 테이블 행 배열 → 연도 문자열 배열
// exam_date → year → 첫 번째 숫자값 순으로 탐색
// select('*')와 조합하여 컬럼 존재 여부에 독립적으로 동작합니다.
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

  // [NEW-1] grade 파라미터 수신
  // premium 유저에게만 적용되며, free / admin은 무시합니다.
  const { grade } = req.body;
  const gradeValue = grade && String(grade).trim() !== '' ? String(grade).trim() : null;

  // [FIX-2025-3] free 유저: 연도 필터 미제공 — 빈 배열 즉시 반환
  // 클라이언트(premium.html)에서 sel-year를 disabled 처리하므로
  // 정상 흐름에서는 호출되지 않지만, 직접 호출 우회를 서버에서도 차단합니다.
  if (userStatus === 'free') {
    console.log('[years.js] free 유저 — 연도 필터 미제공 → 빈 배열 반환');
    return res.status(200).json([]);
  }

  // [NEW-1] premium 유저가 급수를 선택하지 않은 경우 빈 배열 반환
  // 클라이언트(premium.html)에서 급수 미선택 시 API를 호출하지 않도록
  // 처리하지만, 혹시 호출되더라도 빈 배열로 안전하게 응답합니다.
  if (userStatus === 'premium' && !gradeValue) {
    console.log('[years.js] premium 유저 — grade 미선택 → 빈 배열 반환');
    return res.status(200).json([]);
  }

  try {
    let years = [];

    const viewName = userStatus === 'admin'
      ? 'unique_years'
      : userStatus === 'premium'
        ? 'unique_years_premium'
        : 'unique_years_free';

    // ── 1차: 뷰 조회 ──────────────────────────────
    // [NEW-1] premium 유저는 grade 컬럼으로 추가 필터링합니다.
    //         unique_years_premium 뷰는 explanation 완전성 조건을 포함하므로
    //         grade 필터만 추가하면 원하는 결과를 얻을 수 있습니다.
    //         free / admin 유저는 grade 파라미터를 무시하고 전체 연도를 반환합니다.
    let viewQuery = supabase.from(viewName).select('*');
    if (userStatus === 'premium' && gradeValue) {
      viewQuery = viewQuery.eq('grade', gradeValue);
    }

    const { data: viewData, error: viewError } = await viewQuery;

    if (!viewError && viewData?.length > 0) {
      // 뷰 정상 동작 + 결과 있음
      console.log(
        `[years.js] 뷰 "${viewName}" 성공, 건수:`, viewData.length,
        '샘플:', viewData.slice(0, 3)
      );
      years = extractYears(viewData);

    } else if (!viewError && viewData?.length === 0 && userStatus === 'premium') {
      // [NEW-2] premium 유저: 뷰가 정상 동작했으나 결과가 0건
      // → "해당 급수에 explanation이 완전히 채워진 연도 없음"이므로
      //   폴백 없이 빈 배열을 즉시 반환합니다.
      //   폴백으로 넘어가면 explanation 완전성 조건을 우회하게 되어
      //   의도하지 않은 연도가 목록에 표시될 수 있습니다.
      console.log(
        `[years.js] 뷰 "${viewName}" 정상 동작 — premium 유저 조건 미충족으로 0건`,
        '/ grade:', gradeValue
      );
      years = [];

    } else {
      // ── 2차: questions 직접 쿼리 폴백 ────────────────────────
      // 뷰 자체에 오류(viewError)가 있을 때만 진입합니다.
      // free 유저는 상단에서 이미 차단되므로 admin/premium 유저만 진입합니다.
      if (viewError) {
        console.warn(`[years.js] 뷰 "${viewName}" 오류:`, viewError.message, viewError.code);
      } else {
        console.warn(`[years.js] 뷰 "${viewName}" 결과 없음 → 직접 쿼리 폴백`);
      }

      let q = supabase.from('questions').select('*');

      // [FIX-2025-3] free 유저는 상단에서 빈 배열로 즉시 반환되므로 이 분기에 진입하지 않음
      // admin은 제한 없음. premium만 아래 조건 적용.
      if (userStatus === 'premium') {
        // [FIX-2025-4] questions.js와 동일한 조건: is_premium=TRUE AND explanation IS NOT NULL
        if (gradeValue) q = q.eq('grade', gradeValue);
        q = q
          .eq('is_premium', true)
          .not('explanation', 'is', null);
      }

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