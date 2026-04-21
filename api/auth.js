// auth.js
// [C-1] 수정: 로그인 성공 시 Supabase access_token을 클라이언트에 반환.
//             이후 모든 API 호출에서 클라이언트가 이 토큰을 Authorization 헤더로 전송하고,
//             서버는 이를 검증해 권한을 판단합니다 (body.userStatus 신뢰 제거).
// [C-2] 수정: 이메일 미인증 상태에서 로그인 시도 시 403 반환.
//             비밀번호 재설정(reset / set-new-password) 액션 추가.

import { createClient } from '@supabase/supabase-js';

// Service Role Key: 서버 내부 DB 조회 전용 (클라이언트에 절대 노출 금지)
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method Not Allowed' });
  }

  const { action } = req.query;

  try {
    // ────────────────────────────────────────────────
    // 로그인
    // ────────────────────────────────────────────────
    if (action === 'login') {
      const { email, password } = req.body;
      if (!email || !password) {
        return res.status(400).json({ message: '이메일과 비밀번호를 입력해주세요.' });
      }

      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;

      // [C-2] 이메일 인증 여부 확인
      if (!data.user.email_confirmed_at) {
        return res.status(403).json({
          message: '이메일 인증이 필요합니다. 받은 편지함을 확인하고 인증 링크를 클릭해주세요.'
        });
      }

      // DB에서 프로필 조회
      const { data: userProfile, error: profileError } = await supabase
        .from('users')
        .select('user_status, name, expiry_date')
        .eq('id', data.user.id)
        .single();

      if (profileError) throw profileError;

      // 만료일 지난 premium 유저 자동 다운그레이드
      let status = userProfile?.user_status || 'free';
      if (status === 'premium' && userProfile?.expiry_date) {
        if (new Date(userProfile.expiry_date) < new Date()) {
          await supabase
            .from('users')
            .update({ user_status: 'free' })
            .eq('id', data.user.id);
          status = 'free';
        }
      }

      // [C-1] access_token을 클라이언트에 반환 — 이후 API 호출 시 Authorization 헤더로 사용
      return res.status(200).json({
        user: {
          id   : data.user.id,
          email: data.user.email,
          name : userProfile?.name || ''
        },
        status,
        // 클라이언트는 이 토큰을 sessionStorage에 저장하고
        // 모든 API 요청 헤더에 'Authorization: Bearer <token>' 형태로 포함해야 합니다.
        accessToken: data.session.access_token
      });
    }

    // ────────────────────────────────────────────────
    // 회원가입
    // ────────────────────────────────────────────────
    if (action === 'signup') {
      const { email, password, name } = req.body;
      if (!email || !password || !name) {
        return res.status(400).json({ message: '이름, 이메일, 비밀번호를 모두 입력해주세요.' });
      }
      if (password.length < 6) {
        return res.status(400).json({ message: '비밀번호는 6자 이상이어야 합니다.' });
      }
      if (name.length > 20) {
        return res.status(400).json({ message: '이름은 20자 이내로 입력해주세요.' });
      }

      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { name } }
      });
      if (error) throw error;

      // users 테이블에 프로필 행 삽입
      // signUp 후 user.id가 즉시 발급되지 않는 경우(이메일 인증 필요 설정)를 대비해
      // id가 있을 때만 삽입합니다.
      if (data.user?.id) {
        await supabase
          .from('users')
          .insert([{ id: data.user.id, email, name, user_status: 'free' }]);
      }

      return res.status(200).json({
        message: '가입 완료! 이메일 받은 편지함에서 인증 링크를 클릭해주세요.'
      });
    }

    // ────────────────────────────────────────────────
    // [C-2] 비밀번호 재설정 — 이메일 발송
    // ────────────────────────────────────────────────
    if (action === 'reset-password') {
      const { email } = req.body;
      if (!email) {
        return res.status(400).json({ message: '이메일을 입력해주세요.' });
      }

      // redirectTo: 사용자가 링크 클릭 후 돌아올 페이지
      // Supabase가 URL에 token_hash와 type=recovery를 붙여줍니다.
      const siteUrl = process.env.SITE_URL || 'https://your-domain.vercel.app';
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${siteUrl}/index.html?type=recovery`
      });

      // 보안상 이메일 존재 여부를 노출하지 않음 — 항상 200 반환
      if (error) {
        console.error('resetPasswordForEmail error:', error.message);
      }

      return res.status(200).json({
        message: '재설정 링크를 발송했습니다. 이메일을 확인해주세요. (스팸함도 확인해주세요)'
      });
    }

    // ────────────────────────────────────────────────
    // [C-2] 비밀번호 재설정 — 새 비밀번호 저장
    // 클라이언트가 이메일 링크 클릭 후 획득한 access_token을 헤더로 전송해야 합니다.
    // ────────────────────────────────────────────────
    if (action === 'set-new-password') {
      const { password } = req.body;
      const authHeader = req.headers.authorization;

      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ message: '인증 토큰이 없습니다.' });
      }
      if (!password || password.length < 6) {
        return res.status(400).json({ message: '비밀번호는 6자 이상이어야 합니다.' });
      }

      const token = authHeader.split(' ')[1];

      // 복구 토큰으로 유저 세션을 생성한 뒤 비밀번호 변경
      const { data: sessionData, error: sessionError } =
        await supabase.auth.getUser(token);
      if (sessionError || !sessionData.user) {
        return res.status(401).json({ message: '유효하지 않거나 만료된 토큰입니다. 재설정 링크를 다시 요청해주세요.' });
      }

      // Service Role Key를 사용하는 Admin API로 비밀번호 변경
      const { error: updateError } = await supabase.auth.admin.updateUserById(
        sessionData.user.id,
        { password }
      );
      if (updateError) throw updateError;

      return res.status(200).json({ message: '비밀번호가 성공적으로 변경되었습니다.' });
    }

    return res.status(400).json({ message: 'Invalid auth action' });

  } catch (error) {
    console.error(`[auth.js] action=${action}`, error.message);
    return res.status(500).json({ message: error.message });
  }
}
