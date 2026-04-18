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

    // 3. 연도 필터링 (범위 검색으로 변경하여 데이터 타입 충돌 방지)
    // 20100000 이상 20109999 이하의 날짜를 찾습니다.
    if (year && year.length === 4) {
      const start = parseInt(year + "0000");
      const end = parseInt(year + "9999");
      query = query.gte('exam_date', start).lte('exam_date', end);
    }

    // 4. 등급 제한
    if (userStatus === 'free') {
      query = query.limit(10);
    }

    const { data, error } = await query;

    if (error) throw error;

    // 데이터가 없는 경우 빈 배열 반환
    if (!data) return res.status(200).json([]);

    // 랜덤 섞기
    const shuffled = data.sort(() => 0.5 - Math.random());
    
    res.status(200).json(shuffled);
  } catch (error) {
    console.error("Server Error:", error.message);
    res.status(500).json({ message: "서버 내부 오류: " + error.message });
  }
}
