// years.js
// [C-1] 수정: body.userStatus → Authorization 헤더 JWT 검증으로 교체.

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// ─────────────────────────────────────────────────────────────────
// [C-1] 공통 JWT 검증 헬퍼
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

  // 만료된 premium → free 취급
  let status = profile.user_status;
  if (status === 'premium' && profile.expiry_date) {
    if (new Date(profile.expiry_date) < new Date()) {
      status = 'free';
    }
  }

  return { id: user.id, user_status: status };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method Not Allowed' });
  }

  // 캐시 방지 헤더
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');

  // [C-1] JWT 검증
  const requester = await verifyUser(req);
  if (!requester) {
    return res.status(401).json({ message: '로그인이 필요합니다.' });
  }

  const userStatus = requester.user_status; // DB 조회 결과 사용

  try {
    let years = [];

    if (userStatus === 'free') {
      // ── FREE: unique_years_free 뷰 우선 시도 ──────────────
      const { data: viewData, error: viewError } = await supabase
        .from('unique_years_free')
        .select('year');

      if (!viewError && viewData?.length > 0) {
        years = viewData.map(d => d.year);
      } else {
        console.warn('[years.js] unique_years_free 뷰 조회 실패 → 직접 쿼리 폴백');
        const { data, error } = await supabase
          .from('questions')
          .select('exam_date')
          .eq('is_premium', false);
        if (error) throw error;
        years = [...new Set(data.map(d => String(d.exam_date).substring(0, 4)))];
      }

    } else if (userStatus === 'premium') {
      // ── PREMIUM: unique_years_premium 뷰 우선 시도 ────────
      const { data: viewData, error: viewError } = await supabase
        .from('unique_years_premium')
        .select('year');

      if (!viewError && viewData?.length > 0) {
        years = viewData.map(d => d.year);
      } else {
        console.warn('[years.js] unique_years_premium 뷰 조회 실패 → 직접 쿼리 폴백');
        const { data, error } = await supabase
          .from('questions')
          .select('exam_date')
          .eq('is_premium', true)
          .eq('is_verified', true);
        if (error) throw error;
        years = [...new Set(data.map(d => String(d.exam_date).substring(0, 4)))];
      }

    } else {
      // ── ADMIN: unique_years 뷰 우선 시도 (전체, 미검수 포함) ──
      const { data: viewData, error: viewError } = await supabase
        .from('unique_years')
        .select('year');

      if (!viewError && viewData?.length > 0) {
        years = viewData.map(d => d.year);
      } else {
        console.warn('[years.js] unique_years 뷰 조회 실패 → 직접 쿼리 폴백');
        const { data, error } = await supabase
          .from('questions')
          .select('exam_date');
        if (error) throw error;
        years = [...new Set(data.map(d => String(d.exam_date).substring(0, 4)))];
      }
    }

    // 공통 정제 및 내림차순 정렬
    const result = years
      .filter(y => y && String(y).length === 4)
      .sort((a, b) => b - a);

    return res.status(200).json(result);

  } catch (error) {
    console.error('[years.js]', error.message);
    return res.status(500).json({ message: error.message });
  }
}
