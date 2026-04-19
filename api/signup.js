import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

export default async function handler(req, res) {
  const { email, password, name } = req.body;

  // 이름 유효성 검사
  if (!name || name.trim().length === 0) {
    return res.status(400).json({ message: '이름을 입력해주세요.' });
  }
  if (name.trim().length > 20) {
    return res.status(400).json({ message: '이름은 20자 이내로 입력해주세요.' });
  }

  try {
    // 1. Supabase Auth에 계정 생성
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email,
      password,
    });

    if (authError) throw authError;

    // 2. 가입 성공 시, users 테이블에도 데이터 추가 (name 컬럼 포함)
    if (authData.user) {
      const { error: dbError } = await supabase
        .from('users')
        .insert([
          {
            id         : authData.user.id,  // Auth의 고유 ID와 연결
            email      : email,
            name       : name.trim(),        // 이름 저장
            user_status: 'free'              // 가입 시 기본 등급
          }
        ]);

      if (dbError) {
        console.error('DB Insert Error:', dbError.message);
      }
    }

    res.status(200).json({ message: '가입 성공! 메일함을 확인해 주세요.' });

  } catch (error) {
    res.status(400).json({ message: error.message });
  }
}
