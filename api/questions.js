import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ message: 'Method Not Allowed' });

  const { grade, category, year, limit, userStatus } = req.body;

  try {
    let query = supabase.from('questions').select('*');

    // 1. 등급/과목 필터
    if (grade) query = query.eq('grade', grade);
    if (category) query = query.eq('category', category);

    // 2. 권한에 따른 제한 (Free 유저는 프리미엄 문제 제외)
    if (userStatus === 'free') {
      query = query.eq('is_premium', false);
    } else if (userStatus === 'premium') {
      // 프리미엄 유저는 검수 완료된 문제만 노출
      query = query.eq('is_verified', true);
    }

    // 3. 연도 필터 (데이터 타입 호환성 확보)
    if (year && year.trim() !== "") {
      // exam_date가 문자열이면 ilike, 날짜/숫자형이면 텍스트 변환 후 비교가 필요할 수 있음
      query = query.gte('exam_date', `${year}-01-01`).lte('exam_date', `${year}-12-31`);
    }

    const { data, error } = await query;
    if (error) throw error;

    if (!data || data.length === 0) {
      return res.status(200).json([]);
    }

    // 4. 무작위 섞기 및 개수 제한
    const shuffled = data.sort(() => Math.random() - 0.5).slice(0, limit || 20);
    return res.status(200).json(shuffled);

  } catch (error) {
    console.error("Questions API Error:", error); // Vercel 로그에 기록됨
    return res.status(500).json({ message: error.message });
  }
}
