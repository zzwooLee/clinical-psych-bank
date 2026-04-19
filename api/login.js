import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

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

    // 2. users 테이블에서 추가 정보 조회 (name 포함)
    const { data: userRows, error: userError } = await supabase
      .from('users')
      .select('id, email, name, user_status, expiry_date')  // name 추가
      .eq('id', authData.user.id);

    if (userError) throw userError;

    // 결과가 없는 경우 기본 권한으로 로그인
    if (!userRows || userRows.length === 0) {
      return res.status(200).json({
        user  : { id: authData.user.id, email: authData.user.email, name: '' },
        status: 'free',
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
        const { error: updateError } = await supabase
          .from('users')
          .update({ user_status: 'free' })
          .eq('id', userData.id);

        if (!updateError) {
          currentStatus = 'free';
          console.log(`${email} 유저의 구독이 만료되어 Free로 전환되었습니다.`);
        }
      }
    }

    // 4. 최종 로그인 정보 반환 (name 포함)
    res.status(200).json({
      user: {
        id   : userData.id,
        email: userData.email,
        name : userData.name || '',   // name 반환 (없으면 빈 문자열)
      },
      status : currentStatus,
      message: 'Login successful'
    });

  } catch (error) {
    console.error('Login error:', error.message);
    res.status(401).json({ message: '이메일 또는 비밀번호가 잘못되었습니다.' });
  }
}
