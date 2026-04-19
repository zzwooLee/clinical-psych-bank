// api/admin/users.js
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

export default async function handler(req, res) {
  // 보안: 관리자 권한 체크
  const { userStatus } = req.body;
  if (userStatus !== 'admin') {
    return res.status(403).json({ message: "권한이 없습니다." }); [cite: 17, 20]
  }

  try {
    // 모든 유저의 ID, 이메일, 등급을 가져옵니다.
    // (테이블명은 본인의 DB 설정에 맞게 'profiles' 등으로 수정하세요)
    const { data, error } = await supabase
      .from('profiles') 
      .select('id, email, status')
      .order('email', { ascending: true });

    if (error) throw error;
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}
