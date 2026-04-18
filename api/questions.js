// api/questions.js
const SUPABASE_URL = process.env.SUPABASE_URL; // Vercel 환경변수에 설정
const SUPABASE_KEY = process.env.SUPABASE_KEY;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ message: 'Method Not Allowed' });

// req.body가 없을 경우를 대비해 빈 객체({})를 기본값으로 설정합니다.
  const body = req.body || {};
  const { grade, category, examDate, userStatus, random } = body;

  // 1. 기본 API 쿼리 빌드
  let query = `${SUPABASE_URL}/rest/v1/questions?select=*`;

  // 2. 권한 및 필터 조건 적용
  if (userStatus === 'free') {
    query += '&is_premium=eq.false'; // 무료 유저는 프리미엄 문제 제외
  }
  if (grade) {
    query += `&grade=eq.${grade}`;
  }
  if (category) {
    query += `&category=eq.${encodeURIComponent(category)}`;
  }
  if (examDate) {
    const year = parseInt(examDate);
    query += `&exam_date=gte.${year}0000&exam_date=lte.${year}9999`;
  }

  try {
    const response = await fetch(query, {
      method: 'GET',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    let data = await response.json();

    // 3. 무작위 셔플 로직 (기존 .gs 로직 그대로 이식)
    if (random) {
      data.sort(() => Math.random() - 0.5);
    }

    // 최대 20개까지만 반환
    return res.status(200).json(data.slice(0, 20));
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
