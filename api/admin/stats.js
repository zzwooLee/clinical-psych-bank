// api/admin/stats.js
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

export default async function handler(req, res) {
  const { userStatus } = req.body;
  if (userStatus !== 'admin') return res.status(403).json({ message: "Forbidden" });

  try {
    // 1. 전체 문제 수 카운트
    const { count: qCount, error: qError } = await supabase
      .from('questions')
      .select('*', { count: 'exact', head: true });

    // 2. 전체 유저 및 등급 정보 (예시 로직)
    const { data: userData, error: uError } = await supabase
      .from('profiles') // 유저 등급 정보가 담긴 테이블 가정
      .select('status');

    if (qError || uError) throw qError || uError;

    const totalUsers = userData.length;
    const premiumUsers = userData.filter(u => u.status === 'premium').length;

    res.status(200).json({
      totalQuestions: qCount,
      activeUsers: Math.floor(totalUsers * 0.7), // 예시 수치
      premiumRate: totalUsers > 0 ? Math.round((premiumUsers / totalUsers) * 100) : 0
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}
