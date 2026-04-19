// api/admin/users.js
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

export default async function handler(req, res) {
  const { userStatus } = req.body;

  // 관리자 권한 체크
  if (userStatus !== 'admin') {
    return res.status(403).json({ message: "권한이 없습니다." });
  }

  try {
    // 테이블 이름을 'users'로 수정했습니다.
    const { data, error } = await supabase
      .from('users') 
      .select('id, email, status')
      .order('email', { ascending: true });

    if (error) throw error;
    res.status(200).json(data);
  } catch (error) {
    console.error("User fetch error:", error.message);
    res.status(500).json({ message: error.message });
  }
}
