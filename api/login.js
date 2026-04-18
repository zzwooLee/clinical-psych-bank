import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ message: 'Method not allowed' });
  
  const { email, password } = req.body;
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) return res.status(400).json({ message: error.message });
  
  // 성공 시 유저 등급 정보도 함께 가져오기
  const { data: profile } = await supabase
    .from('users')
    .select('user_status')
    .eq('id', data.user.id)
    .single();

  return res.status(200).json({ session: data.session, user: data.user, status: profile?.user_status || 'free' });
}
