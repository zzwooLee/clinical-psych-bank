// questions.js
// [C-1] 수정: body.userStatus → Authorization 헤더 JWT 검증으로 교체.
//             JWT 검증 실패 시 401, 권한 없는 문제 요청 시 403 반환.

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

  // 만료일 경과한 premium은 free로 취급 (즉시 DB 갱신 없이 이번 요청에만 적용)
  let status = profile.user_status;
  if (status === 'premium' && profile.expiry_date) {
    if (new Date(profile.expiry_date) < new Date()) {
      status = 'free';
      // 비동기 백그라운드 다운그레이드 (응답 지연 없이)
      supabase
        .from('users')
        .update({ user_status: 'free' })
        .eq('id', user.id)
        .then(() => {})
        .catch(e => console.error('[questions.js] 만료 다운그레이드 실패:', e.message));
    }
  }

  return { id: user.id, user_status: status };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method Not Allowed' });
  }

  // [C-1] JWT 검증
  const requester = await verifyUser(req);
  if (!requester) {
    return res.status(401).json({ message: '로그인이 필요합니다.' });
  }

  const userStatus = requester.user_status; // 클라이언트 body 값이 아닌 DB 조회 결과 사용
  const { grade, category, year, limit } = req.body;

  try {
    let query = supabase.from('questions').select('*');

    // 1. 등급/과목 필터
    if (grade)    query = query.eq('grade', grade);
    if (category) query = query.eq('category', category);

    // 2. 권한에 따른 문제 접근 제한
    if (userStatus === 'free') {
      // free: 프리미엄 문제 제외
      query = query.eq('is_premium', false);
    } else if (userStatus === 'premium') {
      // premium: 검수 완료된 문제 전체 (free + premium)
      query = query.eq('is_verified', true);
    }
    // admin: 필터 없음 (전체 접근)

    // 3. 연도 필터
    if (year && String(year).trim() !== '') {
      query = query
        .gte('exam_date', `${year}-01-01`)
        .lte('exam_date', `${year}-12-31`);
    }

    const { data, error } = await query;
    if (error) throw error;

    if (!data || data.length === 0) {
      return res.status(200).json([]);
    }

    // 4. 서버 사이드 무작위 섞기 및 개수 제한
    const shuffled = data
      .sort(() => Math.random() - 0.5)
      .slice(0, Math.min(limit || 20, 100)); // 최대 100문제 상한

    return res.status(200).json(shuffled);

  } catch (error) {
    console.error('[questions.js]', error.message);
    return res.status(500).json({ message: error.message });
  }
}
