// questions.js
// [C-1] JWT 검증으로 userStatus 판단
// [FIX] exam_date가 int4(20190601 형태)이므로 연도 필터를 정수 범위로 수정
//       gte('exam_date', '2006-01-01') → gte('exam_date', 20060101)

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// ─────────────────────────────────────────────
// JWT 검증 헬퍼
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
    if (new Date(profile.expiry_date) < new Date()) {
      status = 'free';
      // 백그라운드 다운그레이드
      supabase.from('users').update({ user_status: 'free' }).eq('id', user.id)
        .then(() => {}).catch(e => console.error('[questions.js] 다운그레이드 실패:', e.message));
    }
  }

  return { id: user.id, user_status: status };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method Not Allowed' });
  }

  // ── 권한 판단 ────────────────────────────────────────
  // 1순위: JWT 검증
  // 2순위: body.userStatus 폴백 (JWT 없을 때)
  let userStatus = 'free';

  const requester = await verifyUser(req);
  if (requester) {
    userStatus = requester.user_status;
  } else if (req.body?.userStatus) {
    userStatus = req.body.userStatus;
    console.warn('[questions.js] JWT 없음 — body.userStatus 폴백:', userStatus);
  } else {
    return res.status(401).json({ message: '로그인이 필요합니다.' });
  }

  const { grade, category, year, limit } = req.body;

  try {
    let query = supabase.from('questions').select('*');

    // ── 1. 등급/과목 필터 ────────────────────────────
    if (grade)    query = query.eq('grade', grade);
    if (category) query = query.eq('category', category);

    // ── 2. 권한별 문제 접근 제한 ─────────────────────
    if (userStatus === 'free') {
      query = query.eq('is_premium', false);
    } else if (userStatus === 'premium') {
      query = query.eq('is_verified', true);
    }
    // admin: 필터 없음

    // ── 3. 연도 필터 ──────────────────────────────────
    // exam_date 컬럼 타입: int4 (예: 20060601)
    // year 파라미터: 문자열 "2006" 또는 숫자 2006
    if (year && String(year).trim() !== '') {
      const y = parseInt(year, 10);
      if (!isNaN(y)) {
        // 20060101 ~ 20061231 범위로 정수 비교
        query = query
          .gte('exam_date', y * 10000 + 101)    // 20060101
          .lte('exam_date', y * 10000 + 1231);   // 20061231
      }
    }

    const { data, error } = await query;
    if (error) throw error;

    if (!data || data.length === 0) {
      return res.status(200).json([]);
    }

    // ── 4. 무작위 섞기 + 개수 제한 (최대 100) ────────
    const shuffled = data
      .sort(() => Math.random() - 0.5)
      .slice(0, Math.min(parseInt(limit) || 20, 100));

    return res.status(200).json(shuffled);

  } catch (error) {
    console.error('[questions.js] 오류:', error.message);
    return res.status(500).json({ message: error.message });
  }
}
