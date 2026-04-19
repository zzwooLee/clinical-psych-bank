// api/admin/stats.js
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

export default async function handler(req, res) {
  const { userStatus } = req.body;
  if (userStatus !== 'admin') return res.status(403).json({ message: "Forbidden" });

  try {
    // 1. 전체 문제 수 조회
    const { count: qCount, error: qError } = await supabase
      .from('questions')
      .select('*', { count: 'exact', head: true });

    // 2. 전체 유저 데이터 조회 (users 테이블)
    const { data: userData, error: uError } = await supabase
      .from('users')
      .select('user_status');

    if (qError || uError) throw qError || uError;

    const totalUsers = userData ? userData.length : 0;
    // user_status 컬럼명을 기준으로 프리미엄 유저 필터링
    const premiumUsers = userData ? userData.filter(u => u.user_status === 'premium').length : 0;

    res.status(200).json({
      totalQuestions: qCount || 0,
      totalUsers: totalUsers,
      activeUsers: Math.floor(totalUsers * 0.7), // 임시 활성 사용자 수
      premiumRate: totalUsers > 0 ? Math.round((premiumUsers / totalUsers) * 100) : 0
    });
  } catch (error) {
    console.error("Stats API Error:", error.message);
    res.status(500).json({ message: error.message });
  }
}
