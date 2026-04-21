import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ message: 'Method Not Allowed' });

  const { grade, category, year, limit, userStatus } = req.body;

  try {
    let query = supabase.from('questions').select('*');

    if (userStatus === 'free') {
      query = query.eq('is_premium', false);
    }
    if (grade) query = query.eq('grade', grade);
    if (category) query = query.eq('category', category);
    if (year) query = query.ilike('exam_date', `${year}%`);

    const { data, error } = await query;
    if (error) throw error;

    // 셔플 및 리밋 적용
    const shuffled = data.sort(() => Math.random() - 0.5).slice(0, limit || 20);
    return res.status(200).json(shuffled);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
}
