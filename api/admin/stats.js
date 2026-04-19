import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

export default async function handler(req, res) {
  const { userStatus } = req.body;
  if (userStatus !== 'admin') return res.status(403).json({ message: "Forbidden" });

  try {
    const { count: qCount, error: qError } = await supabase
      .from('questions')
      .select('*', { count: 'exact', head: true });

    const { data: userData, error: uError } = await supabase
      .from('users')
      .select('user_status');

    if (qError || uError) throw qError || uError;

    const totalUsers   = userData ? userData.length : 0;
    const premiumUsers = userData ? userData.filter(u => u.user_status === 'premium').length : 0;

    res.status(200).json({
      totalQuestions: qCount || 0,
      totalUsers,
      activeUsers  : Math.floor(totalUsers * 0.7),
      premiumRate  : totalUsers > 0 ? Math.round((premiumUsers / totalUsers) * 100) : 0
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}
