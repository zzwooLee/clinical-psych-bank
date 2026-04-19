// api/signup.js
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

export default async function handler(req, res) {
  const { email, password } = req.body;

  try {
    // 1. Supabase Auth에 계정 생성
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email,
      password,
    });

    if (authError) throw authError;

    // 2. 가입 성공 시, 우리가 만든 'users' 테이블에도 데이터 추가
    if (authData.user) {
      const { error: dbError } = await supabase
        .from('users')
        .insert([
          { 
            id: authData.user.id, // Auth의 고유 ID와 연결
            email: email, 
            user_status: 'free'   // 가입 시 기본 등급
          }
        ]);

      if (dbError) {
        console.error("DB Insert Error:", dbError.message);
        // 여기서 에러가 나도 계정은 생성된 상태일 수 있음
      }
    }

    res.status(200).json({ message: "가입 성공! 메일함을 확인해 주세요." });

  } catch (error) {
    res.status(400).json({ message: error.message });
  }
}
