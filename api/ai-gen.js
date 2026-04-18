// api/ai-gen.js
const CLAUDE_API_KEY = process.env.CLAUDE_API_KEY; // Vercel 환경변수
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ message: 'Method Not Allowed' });

  const { grade, category } = req.body;

  try {
    // 1. 패턴 분석용 기출 데이터 가져오기 (Supabase)
    const patternUrl = `${SUPABASE_URL}/rest/v1/questions?grade=eq.${grade}&category=eq.${encodeURIComponent(category)}&limit=5`;
    const patternRes = await fetch(patternUrl, {
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
    });
    const sampleData = await patternRes.json();

    // 2. Claude 프롬프트 구성 (기존 .gs 파일의 프롬프트 자산 활용)
    const prompt = `당신은 임상심리사 국가고시 출제위원입니다. 
    제시된 기출문제 패턴을 분석하여 실제 시험과 유사한 새로운 문제를 3개 생성하세요.
    패턴 데이터: ${JSON.stringify(sampleData)}
    
    응답은 반드시 아래 JSON 배열 형식으로만 답변하세요:
    [
      { "stem": "상황설명(있을경우)", "question": "문제", "choice1": "보기1", "choice2": "보기2", "choice3": "보기3", "choice4": "보기4", "answer": 정답번호(1-4) }
    ]`;

    // 3. Claude API 호출
    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: "claude-3-sonnet-20240229",
        max_tokens: 1500,
        messages: [{ role: "user", content: prompt }]
      })
    });

    const result = await claudeRes.json();
    const generatedText = result.content[0].text;
    
    // JSON 데이터만 추출하여 파싱
    const jsonMatch = generatedText.match(/\[\s*\{.*\}\s*\]/s);
    const questions = jsonMatch ? JSON.parse(jsonMatch[0]) : [];

    return res.status(200).json(questions);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}