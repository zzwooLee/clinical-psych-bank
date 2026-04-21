import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

export default async function handler(req, res) {
  const { userStatus } = req.body;

  if (userStatus !== 'admin') {
    return res.status(403).json({ message: "권한이 없습니다." });
  }

  try {
    const { data, error } = await supabase
      .from('users')
      // ★ [수정] name 컬럼 추가
      .select('id, email, name, user_status, expiry_date')
      .order('email', { ascending: true });

    if (error) throw error;
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}
