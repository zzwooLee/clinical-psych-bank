const SUPABASE_URL = process.env.SUPABASE_URL;
// [#6 수정] Service Role Key 사용 (서버사이드 전용)
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ message: 'Method Not Allowed' });
    }

    const { grade, category } = req.body;

    try {
        // 1. 패턴 분석용 기출 데이터 가져오기 (Supabase)
        const patternUrl = `${SUPABASE_URL}/rest/v1/questions?grade=eq.${grade}&category=eq.${encodeURIComponent(category)}&is_premium=eq.false&limit=5`;
        const patternRes = await fetch(patternUrl, {
            headers: {
                'apikey'       : SUPABASE_KEY,
                'Authorization': `Bearer ${SUPABASE_KEY}`
            }
        });
        const sampleData = await patternRes.json();

        // 2. Claude 프롬프트 구성
        const prompt = `당신은 임상심리사 국가고시 출제위원입니다.
제시된 기출문제 패턴을 분석하여 실제 시험과 유사한 새로운 문제를 3개 생성하세요.
패턴 데이터: ${JSON.stringify(sampleData)}

응답은 반드시 아래 JSON 배열 형식으로만 답변하세요 (다른 텍스트 일절 금지):
[
  {
    "stem": "상황설명(없으면 빈 문자열)",
    "question": "문제",
    "choice1": "보기1",
    "choice2": "보기2",
    "choice3": "보기3",
    "choice4": "보기4",
    "answer": 정답번호(1~4 숫자),
    "explanation": "해설 (2~3문장)"
  }
]`;

        // 3. Claude API 호출
        // [#5 핵심 수정] 구형 모델 → 최신 모델로 업데이트
        const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
            method : 'POST',
            headers: {
                'x-api-key'        : process.env.CLAUDE_API_KEY,
                'anthropic-version': '2023-06-01',
                'Content-Type'     : 'application/json'
            },
            body: JSON.stringify({
                model     : 'claude-sonnet-4-20250514', // [#5 수정] 최신 모델
                max_tokens: 1500,
                messages  : [{ role: 'user', content: prompt }]
            })
        });

        if (!claudeRes.ok) {
            const errBody = await claudeRes.json();
            throw new Error(errBody?.error?.message || 'Claude API 오류');
        }

        const result        = await claudeRes.json();
        const generatedText = result.content[0].text;

        // JSON 배열만 추출하여 파싱 (```json 펜스 방어)
        const clean     = generatedText.replace(/```json|```/g, '').trim();
        const jsonMatch = clean.match(/\[\s*\{[\s\S]*\}\s*\]/);
        const questions = jsonMatch ? JSON.parse(jsonMatch[0]) : [];

        return res.status(200).json(questions);
    } catch (error) {
        console.error('AI Gen Error:', error.message);
        return res.status(500).json({ error: error.message });
    }
}
