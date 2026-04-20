import { createClient } from '@supabase/supabase-js';

// 일반 클라이언트 — DB 읽기/쓰기용 (Service Role Key)
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// Admin 클라이언트 — auth.admin.deleteUser() 전용
// auth.admin 메서드는 createClient에 auth.persistSession:false 옵션이 필요
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method Not Allowed' });
  }

  const { email, password, name } = req.body;

  // ── 유효성 검사 ──
  if (!name || name.trim().length === 0) {
    return res.status(400).json({ message: '이름을 입력해주세요.' });
  }
  if (name.trim().length > 20) {
    return res.status(400).json({ message: '이름은 20자 이내로 입력해주세요.' });
  }
  if (!email || !password) {
    return res.status(400).json({ message: '이메일과 비밀번호를 입력해주세요.' });
  }
  if (password.length < 6) {
    return res.status(400).json({ message: '비밀번호는 6자 이상이어야 합니다.' });
  }

  try {
    // 1. Supabase Auth 계정 생성
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email,
      password,
    });

    if (authError) throw authError;

    // 중복 이메일 체크 (Supabase는 중복 시 에러 대신 빈 identities 반환)
    if (authData.user?.identities?.length === 0) {
      return res.status(400).json({ message: '이미 가입된 이메일입니다.' });
    }

    // 2. users 테이블에 insert
    if (authData.user) {
      const { error: dbError } = await supabase
        .from('users')
        .insert([{
          id         : authData.user.id,
          email      : email,
          name       : name.trim(),
          user_status: 'free'
        }]);

      if (dbError) {
        console.error('DB Insert Error:', dbError.code, dbError.message);

        // Auth 계정 롤백 — Admin 클라이언트로 호출해야 정상 동작
        const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(
          authData.user.id
        );
        if (deleteError) {
          console.error('Auth rollback failed:', deleteError.message);
        }

        return res.status(500).json({
          message: `회원 정보 저장 실패: ${dbError.message}`
        });
      }
    }

    const message = authData.session
      ? '가입이 완료되었습니다. 로그인해주세요.'
      : '가입 신청 완료! 이메일함을 확인하여 인증을 완료해주세요.';

    res.status(200).json({ message });

  } catch (error) {
    console.error('Signup error:', error.message);
    res.status(400).json({ message: error.message });
  }
}
