// api/admin/update-user.js (Vercel Serverless Function)
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { targetUserId, newStatus, expiryDate, userStatus } = req.body;

  // 관리자 권한 체크
  if (userStatus !== 'admin') {
    return res.status(403).json({ message: "권한이 없습니다." });
  }

  try {
    // 업데이트할 객체 생성
    const updateData = {};
    if (newStatus) updateData.user_status = newStatus; // 등급 업데이트
    if (expiryDate) updateData.expiry_date = expiryDate; // 만료일 업데이트

    const { error } = await supabase
      .from('users')
      .update(updateData)
      .eq('id', targetUserId);

    if (error) throw error;

    return res.status(200).json({ message: "업데이트 완료" });
  } catch (error) {
    console.error("DB Error:", error.message);
    return res.status(500).json({ message: error.message });
  }
}
