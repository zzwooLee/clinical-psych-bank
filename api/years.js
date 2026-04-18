// api/years.js
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

export default async function handler(req, res) {
  try {
    const { data, error } = await supabase
      .from('questions')
      .select('exam_date'); // year 대신 exam_date를 선택

    if (error) throw error;

    // 1. exam_date에서 앞 4자리만 추출 (20100905 -> 2010)
    // 2. 중복 제거 및 내림차순 정렬
    const uniqueYears = [...new Set(data.map(item => {
      const dateStr = String(item.exam_date);
      return dateStr.substring(0, 4); 
    }))]
    .filter(year => year && year.length === 4) // 정상적인 연도만 필터
    .sort((a, b) => b - a);

    res.status(200).json(uniqueYears);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}
