// auth.js
// [C-1] 로그인 성공 시 Supabase access_token을 클라이언트에 반환.
// [C-2] 이메일 미인증 체크, 비밀번호 재설정 액션 추가.
// [FIX] profileError 발생 시 throw 대신 기본값(free) 처리 — users 행 없거나 RLS 오류 시 500 방지.
// [FIX-5] 회원가입 시 미인증 상태에서 users 테이블에 즉시 insert하던 문제 수정.
//         signUp 직후 insert를 제거하고, 로그인 성공(= 이메일 인증 완료) 시점에
//         users 행이 없으면 자동 생성하는 기존 로직(5번)으로 일원화합니다.
//         → 인증 메일을 클릭하지 않은 유령 행이 DB에 쌓이는 문제 해결
//         → 단, Supabase Dashboard에서 auth trigger(on_auth_user_created)를
//           사용하는 경우 이 파일의 로그인 시점 insert 로직과 중복되지 않도록
//           trigger를 우선 사용하고 아래 insert 코드는 제거해도 됩니다.

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method Not Allowed' });
  }

  const { action } = req.query;

  // 환경변수 누락 조기 감지
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_KEY) {
    console.error('[auth.js] SUPABASE_URL 또는 SUPABASE_KEY 환경변수 누락');
    return res.status(500).json({ message: '서버 설정 오류입니다. 관리자에게 문의해주세요.' });
  }

  try {
    // ────────────────────────────────────────────────
    // 로그인
    // ────────────────────────────────────────────────
    if (action === 'login') {
      const { email, password } = req.body;
      if (!email || !password) {
        return res.status(400).json({ message: '이메일과 비밀번호를 입력해주세요.' });
      }

      // 1) Supabase Auth 로그인
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        console.error('[auth.js] signInWithPassword 실패:', error.message);
        throw error;
      }

      // 2) 이메일 인증 여부 확인
      //    Supabase 대시보드 > Authentication > Providers > Email >
      //    "Confirm email" 토글이 OFF이면 이 조건을 제거해도 됩니다.
      if (data.user.email_confirmed_at === null) {
        console.warn('[auth.js] 미인증 이메일 로그인 시도:', email);
        return res.status(403).json({
          message: '이메일 인증이 필요합니다. 받은 편지함을 확인하고 인증 링크를 클릭해주세요.'
        });
      }

      // 3) users 테이블에서 프로필 조회
      //    [FIX] profileError를 throw하지 않고 기본값으로 처리합니다.
      //    흔한 실패 원인:
      //      PGRST116 → users 테이블에 해당 행 없음
      //      42501     → SUPABASE_KEY가 anon key여서 RLS에 막힘
      const { data: userProfile, error: profileError } = await supabase
        .from('users')
        .select('user_status, name, expiry_date')
        .eq('id', data.user.id)
        .single();

      if (profileError) {
        console.error('[auth.js] users 조회 실패 (id:', data.user.id, '):', profileError.message);
        console.error('[auth.js] 힌트: Vercel 환경변수 SUPABASE_KEY가 service_role 키인지 확인하세요.');
      }

      // 4) 만료일 경과한 premium 자동 다운그레이드
      let status = userProfile?.user_status || 'free';
      if (status === 'premium' && userProfile?.expiry_date) {
        if (new Date(userProfile.expiry_date) < new Date()) {
          console.log('[auth.js] premium 만료 — free로 다운그레이드:', data.user.id);
          await supabase
            .from('users')
            .update({ user_status: 'free' })
            .eq('id', data.user.id);
          status = 'free';
        }
      }

      // 5) [FIX-5] users 행이 없으면 로그인 시점에 자동 생성
      //    회원가입 시 insert를 제거했으므로, 이메일 인증 완료 후
      //    첫 로그인 때 이 로직이 실행되어 행을 생성합니다.
      //    RLS 오류(42501)가 아닌 경우에만 시도합니다.
      const isRlsError = profileError?.message?.includes('42501') ||
                         profileError?.code === '42501';
      if (!userProfile && profileError && !isRlsError) {
        console.log('[auth.js] users 행 자동 생성 시도 (첫 로그인):', data.user.id);
        const { error: insertError } = await supabase.from('users').insert([{
          id         : data.user.id,
          email      : data.user.email,
          name       : data.user.user_metadata?.name || '',
          user_status: 'free'
        }]);
        if (insertError) {
          console.error('[auth.js] users 행 자동 생성 실패:', insertError.message);
        }
      }

      console.log('[auth.js] 로그인 성공:', email, '/ status:', status);

      // 6) 응답 — access_token 포함
      return res.status(200).json({
        user: {
          id   : data.user.id,
          email: data.user.email,
          name : userProfile?.name || data.user.user_metadata?.name || ''
        },
        status,
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

      // [FIX-5] 회원가입 직후 users 테이블 insert 제거
      //         이유: 이 시점에서 사용자는 이메일 인증을 완료하지 않은 상태입니다.
      //              미인증 유저가 DB에 행을 가지면 유령 계정이 누적됩니다.
      //              대신 이메일 인증 후 첫 로그인 시(위 login 액션 5번)에 자동 생성됩니다.
      //
      //         [대안] Supabase Dashboard > Database > Functions에서
      //                on_auth_user_created trigger를 설정하면 인증 완료 시점에
      //                자동으로 users 행을 생성할 수 있습니다. (권장)
      //
      // 아래 주석 처리된 코드는 trigger를 사용하지 않는 환경에서
      // 즉시 insert가 필요할 경우를 위해 참고용으로 보존합니다.
      //
      // if (data.user?.id) {
      //   await supabase.from('users').insert([{ id: data.user.id, email, name, user_status: 'free' }]);
      // }

      // Supabase에서 이메일 확인이 비활성화된 경우(Confirm email = OFF),
      // data.user가 즉시 반환되며 email_confirmed_at이 설정됩니다.
      // 이 경우 users 행을 바로 생성해도 무방하므로 아래 조건으로 처리합니다.
      if (data.user?.id && data.user?.email_confirmed_at) {
        console.log('[auth.js] 이메일 확인 비활성화 환경 — 가입 즉시 users 행 생성:', data.user.id);
        const { error: insertError } = await supabase
          .from('users')
          .insert([{ id: data.user.id, email, name, user_status: 'free' }]);
        if (insertError) {
          // 중복 insert(이미 trigger로 생성된 경우)는 무시
          if (!insertError.message.includes('duplicate') && !insertError.code === '23505') {
            console.error('[auth.js] users insert 실패:', insertError.message);
          }
        }
      }

      return res.status(200).json({
        message: '가입 완료! 이메일 받은 편지함에서 인증 링크를 클릭해주세요.'
      });
    }

    // ────────────────────────────────────────────────
    // [C-2] 비밀번호 재설정 이메일 발송
    // ────────────────────────────────────────────────
    if (action === 'reset-password') {
      const { email } = req.body;
      if (!email) {
        return res.status(400).json({ message: '이메일을 입력해주세요.' });
      }

      const siteUrl = process.env.SITE_URL || 'https://your-domain.vercel.app';
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${siteUrl}/index.html?type=recovery`
      });

      if (error) {
        console.error('[auth.js] resetPasswordForEmail 오류:', error.message);
      }

      // 보안상 이메일 존재 여부 미노출 — 성공/실패 무관하게 200 반환
      return res.status(200).json({
        message: '재설정 링크를 발송했습니다. 이메일을 확인해주세요. (스팸함도 확인해주세요)'
      });
    }

    // ────────────────────────────────────────────────
    // [C-2] 새 비밀번호 저장
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

      const { data: sessionData, error: sessionError } =
        await supabase.auth.getUser(token);
      if (sessionError || !sessionData.user) {
        return res.status(401).json({
          message: '유효하지 않거나 만료된 토큰입니다. 재설정 링크를 다시 요청해주세요.'
        });
      }

      const { error: updateError } = await supabase.auth.admin.updateUserById(
        sessionData.user.id,
        { password }
      );
      if (updateError) throw updateError;

      return res.status(200).json({ message: '비밀번호가 성공적으로 변경되었습니다.' });
    }

    return res.status(400).json({ message: 'Invalid auth action' });

  } catch (error) {
    console.error(`[auth.js] action=${action} 예외:`, error.message);
    return res.status(500).json({ message: error.message });
  }
}
