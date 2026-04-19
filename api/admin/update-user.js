// api/admin/update-user.js
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

export default async function handler(req, res) {
  const { targetUserId, newStatus, userStatus } = req.body;

  if (userStatus !== 'admin') {
    return res.status(403).json({ message: "접근 권한이 없습니다." });
  }

  try {
    // 업데이트 대상을 user_status로 변경
    const { error } = await supabase
      .from('users')
      .update({ user_status: newStatus })
      .eq('id', targetUserId);

    if (error) throw error;
    res.status(200).json({ message: "등급 변경 성공" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}
