import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

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
    // ── 1. Auth 계정 생성 ──
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email,
      password,
    });

    if (authError) throw authError;

    // 중복 이메일 체크
    if (authData.user?.identities?.length === 0) {
      return res.status(400).json({ message: '이미 가입된 이메일입니다.' });
    }

    const userId = authData.user?.id;
    if (!userId) throw new Error('Auth 계정 생성에 실패했습니다.');

    // ── 2. upsert — insert 또는 이미 있으면 name/status 업데이트 ──
    // insert 대신 upsert를 사용해 중복 PK 오류를 원천 차단
    const { error: dbError } = await supabase
      .from('users')
      .upsert([{
        id         : userId,
        email      : email,
        name       : name.trim(),
        user_status: 'free'
      }], { onConflict: 'id' });  // id 충돌 시 덮어쓰기

    if (dbError) {
      console.error('DB Upsert Error:', dbError.code, dbError.message);
      await supabaseAdmin.auth.admin.deleteUser(userId).catch(() => {});
      return res.status(500).json({
        message: `회원 정보 저장 실패: ${dbError.message}`
      });
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
