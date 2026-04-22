// questions.js
// [FIX-1] free 유저 limit 서버 강제 제한 추가 (클라이언트 우회 방지)
// [FIX-2] Math.random() sort → Fisher-Yates 셔플로 교체 (통계적 균등성 보장)
// [SEC-1] body.userStatus 폴백 완전 제거 — JWT 검증 실패 시 401 반환
// [SEC-2] verifyUser 내부 오류 완전 방어
// [FIX-3] exam_date int4(YYYYMMDD) 컬럼 → 연도 필터를 정수 범위로 수정

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

    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      console.warn('[questions.js] JWT 검증 실패:', authError?.message);
      return null;
    }

    const { data: profile, error: profileError } = await supabase
      .from('users')
      .select('user_status, expiry_date')
      .eq('id', user.id)
      .single();

    if (profileError || !profile) {
      console.warn('[questions.js] users 조회 실패:', profileError?.message);
      return null;
    }

    let status = profile.user_status || 'free';
    if (status === 'premium' && profile.expiry_date) {
      if (new Date(profile.expiry_date) < new Date()) {
        status = 'free';
        supabase
          .from('users')
          .update({ user_status: 'free' })
          .eq('id', user.id)
          .then(() => {})
          .catch(() => {});
      }
    }

    return { id: user.id, user_status: status };
  } catch (e) {
    console.warn('[questions.js] verifyUser 예외:', e.message);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────
// [FIX-2] Fisher-Yates 셔플
// Math.random() 기반 sort()는 통계적으로 균등하지 않습니다.
// Fisher-Yates는 모든 순열이 동등한 확률을 가집니다.
// ─────────────────────────────────────────────────────────────────
function fisherYatesShuffle(arr) {
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

// ─────────────────────────────────────────────────────────────────
// 핸들러
// ─────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method Not Allowed' });
  }

  const verified = await verifyUser(req);
  if (!verified) {
    console.warn('[questions.js] 인증 실패 → 401 반환');
    return res.status(401).json({ message: '세션이 만료되었습니다. 다시 로그인해주세요.' });
  }

  const userStatus = verified.user_status;
  console.log('[questions.js] JWT 검증 성공 → userStatus:', userStatus);

  const { grade, category, year, limit } = req.body;

  try {
    let query = supabase.from('questions').select('*');

    // ── 1. 등급 / 과목 필터 ──────────────────────────────────
    if (grade)    query = query.eq('grade', grade);
    if (category) query = query.eq('category', category);

    // ── 2. 권한별 접근 제한 ──────────────────────────────────
    if (userStatus === 'free') {
      query = query.eq('is_premium', false);
    } else if (userStatus === 'premium') {
      query = query.eq('is_verified', true);
    }
    // admin: 제한 없음

    // ── 3. 연도 필터 (int4 YYYYMMDD 기준) ───────────────────
    if (year && String(year).trim() !== '') {
      const y = parseInt(year, 10);
      if (!isNaN(y) && y > 1900 && y < 2100) {
        const dateFrom = y * 10000 + 101;
        const dateTo   = y * 10000 + 1231;
        query = query.gte('exam_date', dateFrom).lte('exam_date', dateTo);
        console.log(`[questions.js] 연도 필터: ${dateFrom} ~ ${dateTo}`);
      }
    }

    const { data, error } = await query;
    if (error) throw error;

    if (!data || data.length === 0) {
      console.log('[questions.js] 조건에 맞는 문제 없음');
      return res.status(200).json([]);
    }

    // ── 4. 개수 제한 파싱 ────────────────────────────────────
    const parsedLimit = parseInt(limit, 10);
    let limitNum = Math.min(
      (!isNaN(parsedLimit) && parsedLimit > 0) ? parsedLimit : 20,
      100
    );

    // [FIX-1] free 유저는 서버에서도 최대 20문제로 강제 제한
    //         클라이언트에서 disabled를 우회해도 무효화됩니다.
    if (userStatus === 'free') {
      limitNum = Math.min(limitNum, 20);
    }

    // ── 5. Fisher-Yates 셔플 + 슬라이스 ─────────────────────
    const shuffled = fisherYatesShuffle(data).slice(0, limitNum);

    console.log(`[questions.js] 응답: ${shuffled.length}문제 / 전체 ${data.length}문제`);
    return res.status(200).json(shuffled);

  } catch (error) {
    console.error('[questions.js] 오류:', error.message);
    return res.status(500).json({ message: error.message });
  }
}
