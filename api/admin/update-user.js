// api/admin/update-user.js
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

export default async function handler(req, res) {
  const { targetUserId, newStatus, userStatus } = req.body;

  // 관리자 권한 재검증
  if (userStatus !== 'admin') {
    return res.status(403).json({ message: "Forbidden" }); [cite: 17, 20]
  }

  try {
    const { error } = await supabase
      .from('profiles')
      .update({ status: newStatus })
      .eq('id', targetUserId);

    if (error) throw error;
    res.status(200).json({ message: "Update Success" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}
