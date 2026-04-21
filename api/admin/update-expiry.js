// update-expiry.js
// [SEC-1] requesterId를 body에서 받아 DB 조회하던 방식 제거
//         → Authorization 헤더 JWT 검증으로 교체 (admin.js와 동일한 패턴)
//         클라이언트가 requesterId를 위조해도 무효화됨
// [SEC-2] targetUserId 누락 / months 유효성 검사 추가

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// ─────────────────────────────────────────────────────────────────
// JWT 검증 헬퍼 (admin.js와 동일한 패턴)
// · admin 권한 확인 포함
// · 성공 시 { id, user_status } 반환, 실패 시 null 반환
// ─────────────────────────────────────────────────────────────────
async function verifyAdmin(req) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) return null;

    const token = authHeader.split(' ')[1];

    // Supabase가 JWT를 검증하고 사용자 정보 반환
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) {
      console.warn('[update-expiry.js] JWT 검증 실패:', error?.message);
      return null;
    }

    // DB에서 직접 권한 조회 (클라이언트 전달 값 사용 안 함)
    const { data: profile, error: profileError } = await supabase
      .from('users')
      .select('user_status')
      .eq('id', user.id)
      .single();

    if (profileError || !profile) {
      console.warn('[update-expiry.js] users 조회 실패:', profileError?.message);
      return null;
    }

    return { id: user.id, user_status: profile.user_status };
  } catch (e) {
    console.warn('[update-expiry.js] verifyAdmin 예외:', e.message);
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

  // ── [SEC-1] JWT 검증 — body의 requesterId는 완전히 무시 ─────
  const requester = await verifyAdmin(req);
  if (!requester) {
    return res.status(401).json({ message: 'Unauthorized: 유효하지 않은 토큰입니다.' });
  }
  if (requester.user_status !== 'admin') {
    return res.status(403).json({ message: 'Forbidden: 관리자 권한이 필요합니다.' });
  }

  // body에서 필요한 값만 추출 (requesterId는 더 이상 사용 안 함)
  const { targetUserId, months } = req.body;

  // ── [SEC-2] 입력 유효성 검사 ──────────────────────────────
  if (!targetUserId) {
    return res.status(400).json({ message: 'targetUserId가 필요합니다.' });
  }

  const parsedMonths = parseInt(months, 10);
  if (isNaN(parsedMonths) || parsedMonths < 1 || parsedMonths > 60) {
    return res.status(400).json({ message: 'months는 1~60 사이의 정수여야 합니다.' });
  }

  // 오늘부터 입력된 개월 수 뒤 날짜 계산
  const expiry = new Date();
  expiry.setMonth(expiry.getMonth() + parsedMonths);

  try {
    const { error } = await supabase
      .from('users')
      .update({
        user_status: 'premium',
        expiry_date: expiry.toISOString()
      })
      .eq('id', targetUserId);

    if (error) throw error;

    console.log(
      `[update-expiry.js] 구독 갱신 완료 — targetUserId: ${targetUserId},`,
      `만료일: ${expiry.toISOString()}, 처리자: ${requester.id}`
    );

    return res.status(200).json({ message: '구독 갱신 완료' });
  } catch (e) {
    console.error('[update-expiry.js] 오류:', e.message);
    return res.status(500).json({ message: e.message });
  }
}
