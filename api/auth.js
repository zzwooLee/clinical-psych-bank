// auth.js
// ─────────────────────────────────────────────────────────────────
// 수정 이력
// [FIX-Critical-1] reset-password redirectTo — Supabase 대시보드 Redirect URLs
//                  허용 목록에 SITE_URL/index.html 등록 필요 주석 강화 및
//                  SITE_URL 미설정 시 경고 로그 추가
// [FIX-Critical-2] login — users 행 자동생성 로직을 insert → upsert로 교체
//                  signup 직후 로그인 시 중복 insert 경쟁 조건 해소
// [FIX-High-1]    questions.js / years.js와 동일하게 premium 만료 처리를
//                  fire-and-forget → await + 실패 로그로 교체
// [FIX-High-2]    기존 FIX 사항 유지
//                  · insertError 조건 논리 오류 수정 (code !== '23505')
//                  · set-new-password service_role 키 의존성 주석 유지
//                  · profileError 발생 시 기본값(free) 처리 유지
//                  · 미인증 이메일 체크 위치 최적화 유지
//                  · PGRST116 명시적 처리 유지
// ─────────────────────────────────────────────────────────────────

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

      // 이메일 인증 체크 — signInWithPassword 직후, users 조회 이전
      // 미인증 사용자가 isNotFound 조건을 만족해 users 행이 삽입되는 버그 방지
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
          // [FIX-High-1] fire-and-forget → await + 실패 로그
          const { error: downgradeErr } = await supabase
            .from('users')
            .update({ user_status: 'free' })
            .eq('id', data.user.id);
          if (downgradeErr) {
            console.error('[auth.js] premium 만료 처리 DB 업데이트 실패:', downgradeErr.message);
          }
          status = 'free';
        }
      }

      // users 행 자동생성 조건
      // PGRST116(행 없음) 코드를 명시적으로 처리하고,
      // profileError 없이 userProfile이 null인 경우도 포함
      const isRlsError = profileError?.message?.includes('42501') || profileError?.code === '42501';
      const isNotFound = profileError?.code === 'PGRST116' || (!userProfile && !isRlsError);

      if (isNotFound) {
        console.log('[auth.js] users 행 자동 생성 시도 (첫 로그인):', data.user.id);
        // [FIX-Critical-2] insert → upsert 교체
        // signup(email_confirmed_at 존재 환경) 직후 로그인 시 insert 경쟁 조건 해소
        // onConflict: 'id' + ignoreDuplicates: true → 중복 시 기존 행 유지
        const { error: upsertError } = await supabase.from('users').upsert([{
          id         : data.user.id,
          email      : data.user.email,
          name       : data.user.user_metadata?.name || '',
          user_status: 'free'
        }], { onConflict: 'id', ignoreDuplicates: true });

        if (upsertError) {
          console.error('[auth.js] users 행 자동 생성 실패:', upsertError.message);
        }
      }

      console.log('[auth.js] 로그인 성공:', email, '/ status:', status);

      return res.status(200).json({
        user: {
          id   : data.user.id,
          email: data.user.email,
          // user_metadata.name을 name 필드로 명시적으로 전달
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
        // [FIX-Critical-2] upsert 적용 — login과 경쟁 시에도 안전
        const { error: upsertError } = await supabase
          .from('users')
          .upsert([{ id: data.user.id, email, name, user_status: 'free' }], {
            onConflict    : 'id',
            ignoreDuplicates: true
          });
        if (upsertError) {
          console.error('[auth.js] users upsert 실패:', upsertError.message);
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

      // [FIX-Critical-1] SITE_URL 미설정 시 경고 로그 추가
      // Supabase 대시보드 → Authentication → URL Configuration → Redirect URLs 에
      // 아래 URL을 반드시 등록해야 비밀번호 재설정 링크가 정상 동작합니다:
      //   {SITE_URL}/index.html
      // 예: https://your-domain.vercel.app/index.html
      if (!process.env.SITE_URL) {
        console.warn(
          '[auth.js] SITE_URL 환경변수가 설정되지 않았습니다. ' +
          'reset-password redirectTo가 기본값으로 동작하며, ' +
          'Supabase Redirect URLs 허용 목록에 실제 도메인/index.html을 등록했는지 확인하세요.'
        );
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
    // [주의] supabase.auth.admin.updateUserById()는 service_role 키 필수
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
