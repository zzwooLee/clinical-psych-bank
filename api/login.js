import { createClient } from '@supabase/supabase-js';

// ── Auth 로그인용 클라이언트 (일반)
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// ★ [추가] DB 조회·수정 전용 클라이언트
// Service Role Key + 세션 비활성화 → RLS 완전 우회
// RLS 정책에서 auth.uid() 컨텍스트 없이도 전체 접근 가능
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method Not Allowed' });
  }

  const { email, password } = req.body;

  try {
    // 1. Supabase Auth 로그인 시도
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (authError) throw authError;

    // 2. ★ [수정] supabaseAdmin으로 users 테이블 조회 → RLS 우회
    // 기존 supabase 클라이언트는 Auth 세션 컨텍스트가 없어
    // RLS의 auth.uid()가 null을 반환하여 조회가 차단됨
    const { data: userRows, error: userError } = await supabaseAdmin
      .from('users')
      .select('id, email, name, user_status, expiry_date')
      .eq('id', authData.user.id);

    if (userError) throw userError;

    // 결과가 없는 경우 기본 권한으로 로그인
    if (!userRows || userRows.length === 0) {
      return res.status(200).json({
        user   : { id: authData.user.id, email: authData.user.email, name: '' },
        status : 'free',
        message: '유저 상세 정보가 없어 기본 등급으로 로그인합니다.'
      });
    }

    const userData      = userRows[0];
    let   currentStatus = userData.user_status;
    const today         = new Date();

    // 3. 구독 만료 체크 — premium인데 만료일이 지났으면 free로 강등
    if (currentStatus === 'premium' && userData.expiry_date) {
      const expiryDate = new Date(userData.expiry_date);
      if (expiryDate < today) {
        // ★ [수정] supabaseAdmin으로 업데이트 → RLS 우회
        const { error: updateError } = await supabaseAdmin
          .from('users')
          .update({ user_status: 'free' })
          .eq('id', userData.id);

        if (!updateError) {
          currentStatus = 'free';
          console.log(`${email} 유저의 구독이 만료되어 Free로 전환되었습니다.`);
        }
      }
    }

    // 4. 최종 로그인 정보 반환
    res.status(200).json({
      user: {
        id   : userData.id,
        email: userData.email,
        name : userData.name || '',
      },
      status : currentStatus,
      message: 'Login successful'
    });

  } catch (error) {
    console.error('Login error:', error.message);
    res.status(401).json({ message: '이메일 또는 비밀번호가 잘못되었습니다.' });
  }
}
