// api/admin/update-user.js
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

export default async function handler(req, res) {
  const { targetUserId, newStatus, userStatus } = req.body;

  // 관리자 권한 재검증
  if (userStatus !== 'admin') {
    return res.status(403).json({ message: "접근 권한이 없습니다." });
  }

  try {
    // 'users' 테이블의 등급(status)을 업데이트합니다.
    const { error } = await supabase
      .from('users')
      .update({ status: newStatus })
      .eq('id', targetUserId);

    if (error) throw error;
    res.status(200).json({ message: "등급 변경 성공" });
  } catch (error) {
    console.error("Update error:", error.message);
    res.status(500).json({ message: error.message });
  }
}
