// debug-years.js — 임시 진단 전용 엔드포인트
// 배포 후 브라우저에서 아래를 실행해 결과를 확인하세요:
//   fetch('/api/debug-years', {method:'POST'}).then(r=>r.json()).then(console.log)
// 확인 후 반드시 삭제하세요.

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const report = {};

  // 1. 환경변수 확인
  report.env = {
    hasUrl : !!process.env.SUPABASE_URL,
    hasKey : !!process.env.SUPABASE_KEY,
    keyPrefix: process.env.SUPABASE_KEY?.substring(0, 20) + '...'
  };

  // 2. questions 테이블 직접 접근 (필터 없음, 5건)
  try {
    const { data, error } = await supabase
      .from('questions')
      .select('exam_date, is_premium, is_verified')
      .limit(5);
    report.questions_sample = error
      ? { error: error.message, code: error.code }
      : data;
  } catch (e) {
    report.questions_sample = { exception: e.message };
  }

  // 3. 뷰 접근 시도
  for (const view of ['unique_years_free', 'unique_years_premium', 'unique_years']) {
    try {
      const { data, error } = await supabase.from(view).select('*').limit(5);
      report[view] = error
        ? { error: error.message, code: error.code }
        : data;
    } catch (e) {
      report[view] = { exception: e.message };
    }
  }

  // 4. Authorization 헤더 수신 여부
  report.auth_header = req.headers.authorization
    ? req.headers.authorization.substring(0, 30) + '...'
    : 'MISSING';

  return res.status(200).json(report);
}
