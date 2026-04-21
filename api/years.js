// years.js
// [FIX] 뷰 구조 확정 반영:
//   - 컬럼명: year 없음, exam_date 로 반환
//   - 타입: int4 (예: 2019, 2020 — 뷰에서 앞 4자리만 잘라서 저장)
//   - 폴백 직접 쿼리: exam_date int4 값이 20190601 형태일 수 있음

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// ─────────────────────────────────────────────────────────────────
// JWT 검증 헬퍼
// ─────────────────────────────────────────────────────────────────
async function verifyUser(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;

  const token = authHeader.split(' ')[1];
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return null;

  const { data: profile, error: profileError } = await supabase
    .from('users')
    .select('user_status, expiry_date')
    .eq('id', user.id)
    .single();

  if (profileError || !profile) return null;

  let status = profile.user_status || 'free';
  if (status === 'premium' && profile.expiry_date) {
    if (new Date(profile.expiry_date) < new Date()) status = 'free';
  }

  return { id: user.id, user_status: status };
}

// ─────────────────────────────────────────────────────────────────
// 어떤 값이든 4자리 연도 문자열로 변환
// int4 2019       → "2019"
// int4 20190601   → "2019"  (직접쿼리 폴백 시 YYYYMMDD 형태)
// string "2019"   → "2019"
// string "2019-06-01" → "2019"
// ─────────────────────────────────────────────────────────────────
function toYear(val) {
  if (val === null || val === undefined) return null;
  const s = String(val).trim().replace(/[^0-9]/g, ''); // 숫자만 추출
  if (s.length < 4) return null;
  const y = s.substring(0, 4);
  // 1900~2100 범위 검증
  const n = Number(y);
  if (n < 1900 || n > 2100) return null;
  return y;
}

// ─────────────────────────────────────────────────────────────────
// 뷰 결과 배열 → 연도 문자열 배열
// 컬럼명이 'year'이든 'exam_date'이든 첫 번째 값을 사용
// ─────────────────────────────────────────────────────────────────
function rowsToYears(rows) {
  return rows
    .map(row => {
      // 컬럼명 우선순위: year → exam_date → 첫 번째 값
      const val = row.year ?? row.exam_date ?? Object.values(row)[0];
      return toYear(val);
    })
    .filter(Boolean);
}

// ─────────────────────────────────────────────────────────────────
// 뷰 조회
// ─────────────────────────────────────────────────────────────────
async function queryView(viewName) {
  const { data, error } = await supabase.from(viewName).select('*');
  if (error) {
    console.warn(`[years.js] 뷰 "${viewName}" 조회 실패:`, error.message);
    return null;
  }
  if (!data || data.length === 0) {
    console.warn(`[years.js] 뷰 "${viewName}" 결과 없음`);
    return null;
  }
  console.log(`[years.js] 뷰 "${viewName}" raw 샘플:`, data.slice(0, 3));
  return data;
}

// ─────────────────────────────────────────────────────────────────
// 직접 쿼리 폴백 — exam_date(int4) 기준
// int4 컬럼에 YYYYMMDD 형태로 저장된 경우를 가정
// ─────────────────────────────────────────────────────────────────
async function directQuery(filterFn) {
  let q = supabase.from('questions').select('exam_date');
  q = filterFn(q);
  const { data, error } = await q;
  if (error) {
    console.error('[years.js] 직접 쿼리 실패:', error.message);
    throw error;
  }
  console.log('[years.js] 직접 쿼리 raw 샘플:', data?.slice(0, 3));
  return (data || []).map(r => toYear(r.exam_date)).filter(Boolean);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method Not Allowed' });
  }

  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');

  // JWT 검증
  const requester = await verifyUser(req);
  if (!requester) {
    return res.status(401).json({ message: '로그인이 필요합니다.' });
  }

  const userStatus = requester.user_status;
  console.log('[years.js] userStatus:', userStatus);

  try {
    let rawYears = [];

    if (userStatus === 'free') {
      const rows = await queryView('unique_years_free');
      rawYears = rows
        ? rowsToYears(rows)
        : await directQuery(q => q.eq('is_premium', false));

    } else if (userStatus === 'premium') {
      const rows = await queryView('unique_years_premium');
      rawYears = rows
        ? rowsToYears(rows)
        : await directQuery(q => q.eq('is_verified', true));

    } else {
      // admin
      const rows = await queryView('unique_years');
      rawYears = rows
        ? rowsToYears(rows)
        : await directQuery(q => q);
    }

    // 중복 제거 + 내림차순 정렬
    const result = [...new Set(rawYears)].sort((a, b) => Number(b) - Number(a));

    console.log('[years.js] 최종 응답:', result);

    return res.status(200).json(result);

  } catch (error) {
    console.error('[years.js] 오류:', error.message);
    return res.status(500).json({ message: error.message });
  }
}
