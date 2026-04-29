// questions.js
// ─────────────────────────────────────────────────────────────────
// 수정 이력
// [FIX-High-1] premium 만료 처리 fire-and-forget → await + 실패 로그
//              기존 .then(()=>{}).catch(()=>{}) 패턴은 업데이트 실패 시
//              아무 흔적도 남기지 않아 만료 후에도 premium 접근이 허용될 수 있었음
// [FIX-High-2] Cache-Control: no-store 헤더 추가
//              로그아웃 후 브라우저/CDN 캐시에서 이전 문제 데이터가 재사용되는 것을 방지
// [기존 유지]  free 유저 limit 서버 강제 제한 (클라이언트 우회 방지)
// [기존 유지]  Fisher-Yates 셔플 (통계적 균등성 보장)
// [기존 유지]  body.userStatus 폴백 완전 제거 — JWT 검증 실패 시 401 반환
// [기존 유지]  exam_date int4(YYYYMMDD) 연도 필터 정수 범위 처리
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
        const { error: downgradeErr } = await supabase
          .from('users')
          .update({ user_status: 'free' })
          .eq('id', user.id);
        if (downgradeErr) {
          console.error('[questions.js] premium 만료 처리 DB 업데이트 실패:', downgradeErr.message);
        } else {
          console.log('[questions.js] premium 만료 → free 처리 완료:', user.id);
        }
      }
    }

    return { id: user.id, user_status: status };
  } catch (e) {
    console.warn('[questions.js] verifyUser 예외:', e.message);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────
// Fisher-Yates 셔플
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

  // [FIX-High-2] 캐시 방지 헤더 — years.js와 동일한 패턴
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');

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
      query = query.not('explanation', 'is', null)
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

    // free 유저는 서버에서도 최대 20문제로 강제 제한
    // 클라이언트에서 disabled를 우회해도 무효화됩니다.
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
