import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

export default async function handler(req, res) {
  const { action } = req.query;
  const { email, password, name } = req.body;

  try {
    if (action === 'login') {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;

      const { data: userProfile } = await supabase.from('users').select('user_status, name').eq('id', data.user.id).single();
      return res.status(200).json({
        user: { id: data.user.id, email: data.user.email, name: userProfile?.name },
        status: userProfile?.user_status || 'free'
      });
    } 
    
    if (action === 'signup') {
      const { data, error } = await supabase.auth.signUp({ email, password, options: { data: { name } } });
      if (error) throw error;

      // 초기 유저 정보 저장
      await supabase.from('users').insert([{ id: data.user.id, email, name, user_status: 'free' }]);
      return res.status(200).json({ message: 'Confirmation email sent. Please check your inbox.' });
    }

    return res.status(400).json({ message: 'Invalid auth action' });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
}
