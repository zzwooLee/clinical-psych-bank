/* api/questions.js */
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ message: 'Method not allowed' });

  const { grade, category, year, userStatus } = req.body;

  try {
    let query = supabase.from('questions').select('*');

    // 1. 급수 필터링
    if (grade) {
      query = query.eq('grade', grade);
    }

    // 2. 과목 필터링
    if (category) {
      query = query.eq('category', category);
    }

    // 3. 연도 필터링 (exam_date가 YYYYMMDD 형식이므로 LIKE 'YYYY%' 사용)
    if (year) {
      query = query.like('exam_date', `${year}%`);
    }

    // 4. 등급 권한 (예: free 등급은 10개로 제한 등)
    if (userStatus === 'free') {
      query = query.limit(10);
    }

    const { data, error } = await query;

    if (error) throw error;

    // 문제를 랜덤하게 섞어서 반환
    const shuffled = data.sort(() => 0.5 - Math.random());
    
    res.status(200).json(shuffled);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}
