// api/signup.js
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

    // ─────────────────────────────────────────────────────────────
    // [핵심 체크] identities가 빈 배열이면 이미 가입된 이메일
    // Supabase는 중복 가입 시 에러 대신 빈 identities를 반환함
    // ─────────────────────────────────────────────────────────────
    if (authData.user?.identities?.length === 0) {
      return res.status(400).json({ message: '이미 가입된 이메일입니다.' });
    }

    // 2. users 테이블에 데이터 추가
    if (authData.user) {
      const { error: dbError } = await supabase
        .from('users')
        .insert([
          {
            id         : authData.user.id,
            email      : email,
            name       : name.trim(),
            user_status: 'free'
          }
        ]);

      // DB insert 실패 시 Auth 계정도 삭제 후 에러 반환 (데이터 정합성 보장)
      if (dbError) {
        console.error('DB Insert Error:', dbError.message);
        await supabase.auth.admin.deleteUser(authData.user.id).catch(() => {});
        return res.status(500).json({
          message: '회원 정보 저장에 실패했습니다. 잠시 후 다시 시도해주세요.'
        });
      }
    }

    // 3. 이메일 인증 필요 여부에 따라 메시지 분기
    //    - session이 있으면 인증 없이 바로 가입 완료 (Confirm email 비활성화 상태)
    //    - session이 없으면 이메일 인증 필요
    const message = authData.session
      ? '가입이 완료되었습니다. 로그인해주세요.'
      : '가입 신청이 완료되었습니다. 이메일을 확인하여 인증을 완료해주세요.';

    res.status(200).json({ message });

  } catch (error) {
    console.error('Signup error:', error.message);
    res.status(400).json({ message: error.message });
  }
}
