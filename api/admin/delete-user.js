// api/admin/delete-user.js
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { targetUserId, userStatus } = req.body;

  // 관리자 권한 체크
  if (userStatus !== 'admin') {
    return res.status(403).json({ message: "권한이 없습니다." });
  }

  try {
    // users 테이블에서 해당 ID 삭제
    const { error } = await supabase
      .from('users')
      .delete()
      .eq('id', targetUserId);

    if (error) throw error;

    res.status(200).json({ message: "삭제 완료" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}
