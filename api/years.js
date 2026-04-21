// years.js
// 확정된 DB 구조:
//   - exam_date: int4, 8자리 정수 (예: 20190601)
//   - 뷰가 exam_date / 10000 으로 앞 4자리를 추출해 exam_date 컬럼명으로 반환
//   - 뷰 컬럼명: exam_date (year 아님), 타입: int4 (예: 2019)

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// ─────────────────────────────────────────────
// JWT 검증
// ─────────────────────────────────────────────
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

// ─────────────────────────────────────────────
// int4 값(2019 또는 20190601) → 4자리 연도 문자열
// ─────────────────────────────────────────────
function toYear(val) {
  if (val === null || val === undefined) return null;
  const n = Number(val);
  if (isNaN(n)) return null;

  let y;
  if (n >= 10000000) {
    // 8자리: 20190601 → Math.floor(20190601 / 10000) = 2019
    y = Math.floor(n / 10000);
  } else {
    // 4자리: 2019 → 2019 (뷰에서 이미 나눈 값)
    y = n;
  }

  if (y < 1900 || y > 2100) return null;
  return String(y);
}

// ─────────────────────────────────────────────
// 뷰 조회 → 연도 배열
// ─────────────────────────────────────────────
async function fromView(viewName) {
  const { data, error } = await supabase.from(viewName).select('*');

  if (error) {
    console.error(`[years.js] 뷰 "${viewName}" 오류:`, error.message, error.code);
    return null; // null 반환 → 직접 쿼리 폴백
  }
  if (!data || data.length === 0) {
    console.warn(`[years.js] 뷰 "${viewName}" 데이터 없음`);
    return null;
  }

  console.log(`[years.js] 뷰 "${viewName}" 샘플:`, data.slice(0, 3));

  return data
    .map(row => {
      // 컬럼명이 exam_date 또는 year 둘 다 시도, 없으면 첫 번째 값
      const val = row.exam_date ?? row.year ?? Object.values(row)[0];
      return toYear(val);
    })
    .filter(Boolean);
}

// ─────────────────────────────────────────────
// 직접 쿼리 폴백
// exam_date int4(20190601) → 앞 4자리 추출
// ─────────────────────────────────────────────
async function fromDirectQuery(filterFn) {
  let q = supabase.from('questions').select('exam_date');
  q = filterFn(q);

  const { data, error } = await q;
  if (error) {
    console.error('[years.js] 직접 쿼리 오류:', error.message);
    throw error;
  }

  console.log('[years.js] 직접 쿼리 샘플:', data?.slice(0, 3));

  return (data || [])
    .map(r => toYear(r.exam_date))
    .filter(Boolean);
}

// ─────────────────────────────────────────────
// 핸들러
// ─────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method Not Allowed' });
  }

  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');

  const requester = await verifyUser(req);
  if (!requester) {
    return res.status(401).json({ message: '로그인이 필요합니다.' });
  }

  const userStatus = requester.user_status;
  console.log('[years.js] userStatus:', userStatus);

  try {
    let years = [];

    if (userStatus === 'free') {
      years = (await fromView('unique_years_free'))
           ?? (await fromDirectQuery(q => q.eq('is_premium', false)));

    } else if (userStatus === 'premium') {
      years = (await fromView('unique_years_premium'))
           ?? (await fromDirectQuery(q => q.eq('is_verified', true)));

    } else {
      // admin
      years = (await fromView('unique_years'))
           ?? (await fromDirectQuery(q => q));
    }

    const result = [...new Set(years)].sort((a, b) => Number(b) - Number(a));
    console.log('[years.js] 최종 응답:', result);

    return res.status(200).json(result);

  } catch (error) {
    console.error('[years.js] 핸들러 오류:', error.message);
    return res.status(500).json({ message: error.message });
  }
}
