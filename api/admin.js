// admin.js
// [C-1] 수정: body.userStatus를 신뢰하던 방식 → Authorization 헤더의 JWT를 검증하고
//             DB에서 직접 user_status를 조회하는 방식으로 교체.
//             클라이언트가 아무리 userStatus를 조작해도 서버에서 무효화됩니다.

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// ─────────────────────────────────────────────────────────────────
// [C-1] 공통 JWT 검증 헬퍼
// 클라이언트가 Authorization: Bearer <accessToken> 헤더를 전송해야 합니다.
// 검증 성공 시 { id, user_status } 반환, 실패 시 null 반환.
// ─────────────────────────────────────────────────────────────────
async function verifyUser(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;

  const token = authHeader.split(' ')[1];

  // Supabase가 JWT를 검증하고 사용자 정보를 반환
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return null;

  // DB에서 직접 권한 조회 (클라이언트 전달 값 사용 안 함)
  const { data: profile, error: profileError } = await supabase
    .from('users')
    .select('user_status')
    .eq('id', user.id)
    .single();

  if (profileError || !profile) return null;

  return { id: user.id, user_status: profile.user_status };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method Not Allowed' });
  }

  const { action } = req.query;

  // [C-1] JWT 검증 — body의 userStatus는 완전히 무시
  const requester = await verifyUser(req);
  if (!requester) {
    return res.status(401).json({ message: 'Unauthorized: 유효하지 않은 토큰입니다.' });
  }
  if (requester.user_status !== 'admin') {
    return res.status(403).json({ message: 'Forbidden: 관리자 권한이 필요합니다.' });
  }

  // body에서 필요한 값만 추출 (userStatus는 더 이상 사용하지 않음)
  const { targetUserId, newStatus, expiryDate, questionId, is_verified } = req.body;

  try {
    switch (action) {

      case 'stats': {
        const { count: totalQuestions } = await supabase
          .from('questions')
          .select('*', { count: 'exact', head: true });
        const { count: activeUsers } = await supabase
          .from('users')
          .select('*', { count: 'exact', head: true });
        const { count: premiumUsers } = await supabase
          .from('users')
          .select('*', { count: 'exact', head: true })
          .eq('user_status', 'premium');

        const premiumRate = activeUsers > 0
          ? Math.round((premiumUsers / activeUsers) * 100)
          : 0;

        return res.status(200).json({ totalQuestions, activeUsers, premiumRate });
      }

      case 'users': {
        const { data: users, error } = await supabase
          .from('users')
          .select('*')
          .order('created_at', { ascending: false });
        if (error) throw error;
        return res.status(200).json(users);
      }

      case 'update-user': {
        if (!targetUserId) {
          return res.status(400).json({ message: 'targetUserId가 필요합니다.' });
        }

        const updateData = {};
        if (newStatus)  updateData.user_status  = newStatus;
        if (expiryDate) updateData.expiry_date  = expiryDate;

        if (Object.keys(updateData).length === 0) {
          return res.status(400).json({ message: '변경할 항목이 없습니다.' });
        }

        const { error } = await supabase
          .from('users')
          .update(updateData)
          .eq('id', targetUserId);
        if (error) throw error;

        return res.status(200).json({ message: '변경 사항이 저장되었습니다.' });
      }

      case 'delete-user': {
        if (!targetUserId) {
          return res.status(400).json({ message: 'targetUserId가 필요합니다.' });
        }

        // 1) users 테이블에서 삭제
        const { error: dbError } = await supabase
          .from('users')
          .delete()
          .eq('id', targetUserId);
        if (dbError) throw dbError;

        // 2) Supabase Auth 계정도 삭제 (Service Role 필요)
        //    users 테이블만 삭제하면 Auth에 orphan 레코드가 남아
        //    해당 이메일로 재가입이 불가능해집니다.
        const { error: authError } = await supabase.auth.admin.deleteUser(targetUserId);
        if (authError) {
          // Auth 삭제 실패는 경고만 기록하고 200 반환 (DB는 이미 삭제됨)
          console.error('[admin.js] Auth 계정 삭제 실패:', authError.message);
        }

        return res.status(200).json({ message: '사용자가 삭제되었습니다.' });
      }

      case 'update-question': {
        if (!questionId) {
          return res.status(400).json({ message: 'questionId가 필요합니다.' });
        }

        const { error } = await supabase
          .from('questions')
          .update({ is_verified })
          .eq('id', questionId);
        if (error) throw error;

        return res.status(200).json({ message: '문제 검수 상태가 업데이트되었습니다.' });
      }

      case 'verify-stats': {
        const { count: verified } = await supabase
          .from('questions')
          .select('*', { count: 'exact', head: true })
          .eq('is_verified', true);
        const { count: unverified } = await supabase
          .from('questions')
          .select('*', { count: 'exact', head: true })
          .eq('is_verified', false);

        return res.status(200).json({ verified, unverified });
      }

      default:
        return res.status(400).json({ message: '알 수 없는 액션입니다.' });
    }
  } catch (error) {
    console.error(`[admin.js] action=${action}`, error.message);
    return res.status(500).json({ message: error.message });
  }
}
