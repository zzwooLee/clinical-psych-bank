/**
 * 1. Supabase 공통 호출 (UrlFetchApp -> fetch API로 변경)
 */
async function fetchSupabase(path, method = 'GET', payload = null, config) {
  const url = `${config.SUPABASE_URL}/rest/v1/${path}`;
  const options = {
    method: method,
    headers: {
      'apikey': config.SUPABASE_KEY,
      'Authorization': `Bearer ${config.SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation'
    }
  };
  
  if (payload) options.body = JSON.stringify(payload);

  const res = await fetch(url, options);
  return await res.json();
}

/**
 * 2. 문제 조회 로직 (기존 questions.gs 로직 추출)
 */
async function getQuestionsLogic(filter, userStatus, config) {
  let query = 'questions?select=*';
  if (userStatus === 'free') query += '&is_premium=eq.false';
  if (filter.grade) query += `&grade=eq.${filter.grade}`;
  if (filter.category) query += `&category=eq.${encodeURIComponent(filter.category)}`;

  let data = await fetchSupabase(query, 'GET', null, config);

  // 셔플 로직 유지
  if (filter.random) {
    data.sort(() => Math.random() - 0.5);
  }
  return data.slice(0, 20);
}

/**
 * 3. AI 문제 생성 프롬프트 (ai_question_gen.gs 로직 추출)
 */
function getAiPrompt(patternData, grade, category) {
  return `임상심리사 ${grade}급 ${category} 과목의 기출 패턴을 분석하여 새로운 예상 문제를 생성하라.
  패턴 데이터: ${JSON.stringify(patternData)}
  형식: JSON [ { "stem": "...", "choice1": "...", "answer": 1 } ]`;
}