// admin.js
// [FIX-1] update-user: newStatus 허용값 검증 추가 (free/premium/admin 외 차단)
// [FIX-2] delete-user: Auth 삭제 실패 시 경고 로그 유지 (DB는 이미 삭제됨)
//         — Auth orphan 문제는 Supabase service_role 키 환경에서만 완전 해결 가능
// [C-1] body.userStatus를 신뢰하던 방식 → JWT 검증으로 교체 (기존 유지)

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
    .select('user_status')
    .eq('id', user.id)
    .single();

  if (profileError || !profile) return null;

  return { id: user.id, user_status: profile.user_status };
}

// ─────────────────────────────────────────────────────────────────
// [FIX-1] 허용된 상태값 목록 — 서버에서 강제 검증
// ─────────────────────────────────────────────────────────────────
const VALID_STATUSES = ['free', 'premium', 'admin'];

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method Not Allowed' });
  }

  const { action } = req.query;

  const requester = await verifyUser(req);
  if (!requester) {
    return res.status(401).json({ message: 'Unauthorized: 유효하지 않은 토큰입니다.' });
  }
  if (requester.user_status !== 'admin') {
    return res.status(403).json({ message: 'Forbidden: 관리자 권한이 필요합니다.' });
  }

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

        // [FIX-1] newStatus가 있을 때 허용된 값인지 검증
        if (newStatus !== undefined && newStatus !== null && newStatus !== '') {
          if (!VALID_STATUSES.includes(newStatus)) {
            return res.status(400).json({ message: `유효하지 않은 상태값입니다. 허용값: ${VALID_STATUSES.join(', ')}` });
          }
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

        // 2) Supabase Auth 계정 삭제 (Service Role 키 필요)
        //    [FIX-2] Auth 삭제 실패 시 경고 로그 기록 후 200 반환
        //    DB 삭제는 완료됐으므로 클라이언트에는 성공으로 안내하되,
        //    orphan 계정은 Supabase 대시보드에서 수동 정리가 필요할 수 있습니다.
        const { error: authError } = await supabase.auth.admin.deleteUser(targetUserId);
        if (authError) {
          console.error(
            '[admin.js] Auth 계정 삭제 실패 — Supabase 대시보드에서 수동 정리 필요:',
            authError.message,
            '/ targetUserId:', targetUserId
          );
        } else {
          console.log('[admin.js] Auth 계정 삭제 완료:', targetUserId);
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
