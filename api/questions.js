// questions.js
// [SEC-1] body.userStatus 폴백 완전 제거
//         JWT 검증 실패 시 무조건 401 반환 → 클라이언트가 userStatus를 위조해도 무효
// [SEC-2] verifyUser 내부 오류가 500을 유발하지 않도록 try/catch 완전 방어 (유지)
// [FIX-1] exam_date int4(YYYYMMDD) 컬럼 → 연도 필터를 정수 범위로 수정 (유지)
// [FIX-2] limit 파싱 견고화

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// ─────────────────────────────────────────────────────────────────
// JWT 검증 헬퍼
// · 성공 시 { id, user_status } 반환
// · 실패(토큰 없음 / 만료 / DB 오류) 시 null 반환 — 절대 throw 안 함
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

    // premium 만료 체크 → 만료 시 free로 다운그레이드 (비동기, 결과 무시)
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
// 핸들러
// ─────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method Not Allowed' });
  }

  // ── [SEC-1] 권한 판단: JWT만 신뢰, body 값 일절 사용 안 함 ────
  const verified = await verifyUser(req);
  if (!verified) {
    // 토큰 없음 / 만료 / 위조 → 모두 401로 통일
    console.warn('[questions.js] 인증 실패 → 401 반환');
    return res.status(401).json({ message: '세션이 만료되었습니다. 다시 로그인해주세요.' });
  }

  const userStatus = verified.user_status;
  console.log('[questions.js] JWT 검증 성공 → userStatus:', userStatus);

  // body에서 필터 파라미터만 추출 (userStatus는 더 이상 사용 안 함)
  const { grade, category, year, limit } = req.body;

  try {
    let query = supabase.from('questions').select('*');

    // ── 1. 등급 / 과목 필터 ──────────────────────────────────
    if (grade)    query = query.eq('grade', grade);
    if (category) query = query.eq('category', category);

    // ── 2. 권한별 접근 제한 ──────────────────────────────────
    if (userStatus === 'free') {
      // 무료 유저: 비프리미엄 문제만
      query = query.eq('is_premium', false);
    } else if (userStatus === 'premium') {
      // 프리미엄 유저: 검수 완료 문제만
      query = query.eq('is_verified', true);
    }
    // admin: 제한 없음

    // ── 3. 연도 필터 (int4 YYYYMMDD 기준) ───────────────────
    // exam_date 컬럼: int4, 예) 20060601
    // year 파라미터: "2006" 또는 "" (전체)
    if (year && String(year).trim() !== '') {
      const y = parseInt(year, 10);
      if (!isNaN(y) && y > 1900 && y < 2100) {
        const dateFrom = y * 10000 + 101;   // 20060101
        const dateTo   = y * 10000 + 1231;  // 20061231
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

    // ── 4. 무작위 섞기 + 개수 제한 ──────────────────────────
    // [FIX-2] parseInt 실패(NaN) 및 0 이하 방어
    const parsedLimit = parseInt(limit, 10);
    const limitNum = Math.min(
      (!isNaN(parsedLimit) && parsedLimit > 0) ? parsedLimit : 20,
      100
    );

    const shuffled = data
      .sort(() => Math.random() - 0.5)
      .slice(0, limitNum);

    console.log(`[questions.js] 응답: ${shuffled.length}문제 / 전체 ${data.length}문제`);
    return res.status(200).json(shuffled);

  } catch (error) {
    console.error('[questions.js] 오류:', error.message);
    return res.status(500).json({ message: error.message });
  }
}
