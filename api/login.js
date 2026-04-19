// api/login.js
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

    // 2. users 테이블에서 추가 정보(user_status, expiry_date) 조회
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('id, email, user_status, expiry_date')
      .eq('id', authData.user.id)
      .single();

    if (userError) throw userError;

    let currentStatus = userData.user_status;
    const today = new Date();
    
    // 3. [구독 만료 체크 로직]
    // Premium 회원인데 만료일 정보가 있고, 그 날짜가 오늘보다 과거라면 강등
    if (currentStatus === 'premium' && userData.expiry_date) {
      const expiryDate = new Date(userData.expiry_date);
      
      if (expiryDate < today) {
        // DB 등급 정보 업데이트
        const { error: updateError } = await supabase
          .from('users')
          .update({ user_status: 'free' })
          .eq('id', userData.id);

        if (!updateError) {
          currentStatus = 'free'; // 세션에 반환할 등급 변경
          console.log(`${email} 유저의 구독이 만료되어 Free로 전환되었습니다.`);
        }
      }
    }

    // 4. 최종 로그인 정보 반환
    res.status(200).json({
      user: {
        id: userData.id,
        email: userData.email,
      },
      status: currentStatus, // 최신화된 등급 정보
      message: "Login successful"
    });

  } catch (error) {
    console.error("Login error:", error.message);
    res.status(401).json({ message: "이메일 또는 비밀번호가 잘못되었습니다." });
  }
}
