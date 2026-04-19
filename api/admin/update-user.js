import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { targetUserId, newStatus, expiryDate, userStatus } = req.body;

  if (userStatus !== 'admin') {
    return res.status(403).json({ message: "권한이 없습니다." });
  }

  try {
    const updateData = {};
    if (newStatus)  updateData.user_status = newStatus;
    if (expiryDate) updateData.expiry_date = expiryDate;

    const { error } = await supabase
      .from('users')
      .update(updateData)
      .eq('id', targetUserId);

    if (error) throw error;
    return res.status(200).json({ message: "업데이트 완료" });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
}
