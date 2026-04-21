import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ message: 'Method Not Allowed' });

  const { action } = req.query;
  const { userStatus, targetUserId, newStatus, expiryDate, questionId, is_verified } = req.body;

  // 관리자 권한 체크
  if (userStatus !== 'admin') {
    return res.status(403).json({ message: 'Forbidden: Admin access required' });
  }

  try {
    switch (action) {
      case 'stats': {
        const { count: totalQuestions } = await supabase.from('questions').select('*', { count: 'exact', head: true });
        const { count: activeUsers } = await supabase.from('users').select('*', { count: 'exact', head: true });
        const { count: premiumUsers } = await supabase.from('users').select('*', { count: 'exact', head: true }).eq('user_status', 'premium');
        
        const premiumRate = activeUsers > 0 ? Math.round((premiumUsers / activeUsers) * 100) : 0;
        return res.status(200).json({ totalQuestions, activeUsers, premiumRate });
      }

      case 'users': {
        const { data: users, error } = await supabase.from('users').select('*').order('created_at', { ascending: false });
        if (error) throw error;
        return res.status(200).json(users);
      }

      case 'update-user': {
        const updateData = {};
        if (newStatus) updateData.user_status = newStatus;
        if (expiryDate) updateData.expiry_date = expiryDate;

        const { error } = await supabase.from('users').update(updateData).eq('id', targetUserId);
        if (error) throw error;
        return res.status(200).json({ message: 'User updated successfully' });
      }

      case 'delete-user': {
        const { error } = await supabase.from('users').delete().eq('id', targetUserId);
        if (error) throw error;
        return res.status(200).json({ message: 'User deleted' });
      }

      case 'update-question': {
        const { error } = await supabase.from('questions').update({ is_verified }).eq('id', questionId);
        if (error) throw error;
        return res.status(200).json({ message: 'Question updated' });
      }

      case 'verify-stats': {
        const { count: verified } = await supabase.from('questions').select('*', { count: 'exact', head: true }).eq('is_verified', true);
        const { count: unverified } = await supabase.from('questions').select('*', { count: 'exact', head: true }).eq('is_verified', false);
        return res.status(200).json({ verified, unverified });
      }

      default:
        return res.status(400).json({ message: 'Invalid admin action' });
    }
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
}
