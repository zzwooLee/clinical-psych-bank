// api/years.js
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

export default async function handler(req, res) {
  try {
    // 1. 데이터베이스에서 연도 목록만 중복 없이 가져오기
    const { data, error } = await supabase
      .from('questions')
      .select('year');

    if (error) throw error;

    // 2. 자바스크립트에서 중복 제거 및 정렬
    const uniqueYears = [...new Set(data.map(item => item.year))]
      .filter(year => year != null) // null 값 제거
      .sort((a, b) => b - a); // 내림차순 정렬

    res.status(200).json(uniqueYears);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: error.message });
  }
}
