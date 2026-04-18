// api/years.js
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

export default async function handler(req, res) {
  try {
    // 'year' 컬럼에서 중복을 제거(distinct)하고 오름차순으로 가져옵니다.
    const { data, error } = await supabase
      .from('questions')
      .select('year')
      .not('year', 'is', null) // 연도가 비어있는 데이터는 제외
      .order('year', { ascending: false });

    if (error) throw error;

    // 중복 제거 (데이터베이스에서 처리하지 못한 경우를 대비한 JS 필터링)
    const uniqueYears = [...new Set(data.map(item => item.year))];

    res.status(200).json(uniqueYears);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}
