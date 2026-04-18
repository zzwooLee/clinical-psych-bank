/* api/questions.js */
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ message: 'Method not allowed' });

  const { grade, category, year, limit, userStatus } = req.body;

  try {
    let query = supabase.from('questions').select('*');

    if (grade) query = query.eq('grade', grade);
    if (category) query = query.eq('category', category);
    
    // exam_date(int/text) 기반 연도 필터링 (범위 검색)
    if (year && year.length === 4) {
      const start = parseInt(year + "0000");
      const end = parseInt(year + "9999");
      query = query.gte('exam_date', start).lte('exam_date', end);
    }

    // 등급별 개수 제한 처리
    let finalLimit = 20;
    if (userStatus === 'free') {
      finalLimit = 20; 
    } else {
      finalLimit = limit || 20; // Premium은 요청받은 개수 사용
    }

    query = query.limit(finalLimit);

    const { data, error } = await query;
    if (error) throw error;

    // 랜덤 셔플
    const shuffled = data.sort(() => 0.5 - Math.random());
    
    res.status(200).json(shuffled);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}
