// api/admin/update-user.js
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

export default async function handler(req, res) {
  const { targetUserId, newStatus, expiryDate, userStatus } = req.body;

  if (userStatus !== 'admin') {
    return res.status(403).json({ message: "권한이 없습니다." });
  }

  try {
    const updateData = { user_status: newStatus };
    
    // expiryDate가 전달되었다면 데이터에 포함 (null이면 유지 또는 초기화)
    if (expiryDate !== undefined) {
      updateData.expiry_date = expiryDate;
    }

    const { error } = await supabase
      .from('users')
      .update(updateData)
      .eq('id', targetUserId);

    if (error) throw error;
    res.status(200).json({ message: "Success" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}
