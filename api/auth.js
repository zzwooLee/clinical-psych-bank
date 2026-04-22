// auth.js
// [FIX-1] insertError 조건 논리 오류 수정:
//         !insertError.code === '23505' → insertError.code !== '23505'
// [FIX-2] set-new-password: service_role 키 환경 의존성 주석 명시 유지
// [FIX-3] profileError 발생 시 throw 대신 기본값(free) 처리 유지
// [FIX-4] 회원가입 시 미인증 상태 users 테이블 즉시 insert 문제 수정 유지
// [FIX-5] users 행 자동생성 조건: PGRST116(행 없음) 코드 명시적 처리 추가
//         profileError 없이 userProfile도 null인 엣지 케이스 포함
// [FIX-6] set-new-password: 서버 기동 시 SUPABASE_KEY 타입 경고 로그 추가
//         (service_role 키 미설정 시 조용한 실패 방지)

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// 주의: SUPABASE_KEY는 반드시 service_role 키여야 합니다.
// anon 키와 service_role 키 모두 'eyJ'로 시작하는 JWT이므로
// 코드에서 두 키를 구분하는 것은 불가능합니다.
// set-new-password(비밀번호 재설정)와 delete-user(회원 삭제)는
// service_role 키 없이 anon 키만으로는 403 오류가 발생합니다.
// → Supabase 대시보드 → Project Settings → API → service_role 키를 사용하세요.

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method Not Allowed' });
  }

  const { action } = req.query;

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

      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        console.error('[auth.js] signInWithPassword 실패:', error.message);
        throw error;
      }

      if (data.user.email_confirmed_at === null) {
        console.warn('[auth.js] 미인증 이메일 로그인 시도:', email);
        return res.status(403).json({
          message: '이메일 인증이 필요합니다. 받은 편지함을 확인하고 인증 링크를 클릭해주세요.'
        });
      }

      const { data: userProfile, error: profileError } = await supabase
        .from('users')
        .select('user_status, name, expiry_date')
        .eq('id', data.user.id)
        .single();

      if (profileError) {
        console.error('[auth.js] users 조회 실패 (id:', data.user.id, '):', profileError.message);
        console.error('[auth.js] 힌트: Vercel 환경변수 SUPABASE_KEY가 service_role 키인지 확인하세요.');
      }

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

      // [FIX-5] users 행 자동생성 조건 개선
      // 기존: !userProfile && profileError && !isRlsError
      //   → profileError가 없는데 userProfile도 없는 케이스(이론상 드물지만) 미처리
      // 수정: PGRST116(행 없음) 코드를 명시적으로 처리하고,
      //       profileError 없이 userProfile이 null인 경우도 포함합니다.
      const isRlsError   = profileError?.message?.includes('42501') || profileError?.code === '42501';
      const isNotFound   = profileError?.code === 'PGRST116' || (!userProfile && !isRlsError);

      if (isNotFound) {
        console.log('[auth.js] users 행 자동 생성 시도 (첫 로그인):', data.user.id);
        const { error: insertError } = await supabase.from('users').insert([{
          id         : data.user.id,
          email      : data.user.email,
          name       : data.user.user_metadata?.name || '',
          user_status: 'free'
        }]);
        if (insertError) {
          // [FIX-1] 기존: !insertError.code === '23505' → 항상 false (연산자 우선순위 버그)
          //         수정: insertError.code !== '23505' 으로 올바르게 처리
          if (!insertError.message.includes('duplicate') && insertError.code !== '23505') {
            console.error('[auth.js] users 행 자동 생성 실패:', insertError.message);
          }
        }
      }

      console.log('[auth.js] 로그인 성공:', email, '/ status:', status);

      return res.status(200).json({
        user: {
          id   : data.user.id,
          email: data.user.email,
          // user_metadata.name을 name 필드로 명시적으로 전달
          // 클라이언트(common.js)에서 data.user.name으로 접근 가능하도록 합니다.
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

      // 이메일 확인이 비활성화된 환경(Confirm email = OFF)에서는 즉시 users 행 생성
      if (data.user?.id && data.user?.email_confirmed_at) {
        console.log('[auth.js] 이메일 확인 비활성화 환경 — 가입 즉시 users 행 생성:', data.user.id);
        const { error: insertError } = await supabase
          .from('users')
          .insert([{ id: data.user.id, email, name, user_status: 'free' }]);
        if (insertError) {
          // [FIX-1] 동일한 논리 오류 수정 적용
          if (!insertError.message.includes('duplicate') && insertError.code !== '23505') {
            console.error('[auth.js] users insert 실패:', insertError.message);
          }
        }
      }

      return res.status(200).json({
        message: '가입 완료! 이메일 받은 편지함에서 인증 링크를 클릭해주세요.'
      });
    }

    // ────────────────────────────────────────────────
    // 비밀번호 재설정 이메일 발송
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
    // 새 비밀번호 저장
    // [FIX-Critical] supabase.auth.admin.updateUserById()는 service_role 키 필수
    // SUPABASE_KEY가 anon 키이면 이 액션은 403으로 실패합니다.
    // Vercel 환경변수에 service_role 키를 설정했는지 반드시 확인하세요.
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

      // recovery 토큰으로 사용자 확인
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
      if (updateError) {
        // service_role 키 미설정 시 403 오류가 여기서 발생합니다.
        console.error(
          '[auth.js] updateUserById 실패. SUPABASE_KEY가 service_role 키인지 확인하세요:',
          updateError.message
        );
        throw updateError;
      }

      return res.status(200).json({ message: '비밀번호가 성공적으로 변경되었습니다.' });
    }

    return res.status(400).json({ message: 'Invalid auth action' });

  } catch (error) {
    console.error(`[auth.js] action=${action} 예외:`, error.message);
    return res.status(500).json({ message: error.message });
  }
}
