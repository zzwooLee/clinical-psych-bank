// Slack 버튼 클릭 처리 → DB 등급 변경

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).end();
  }

  try {
    // Slack은 payload를 form-urlencoded로 전송
    // Vercel은 자동으로 파싱하지 않으므로 직접 처리
    let payload;

    if (req.body?.payload) {
      // JSON으로 파싱된 경우
      payload = typeof req.body.payload === 'string'
        ? JSON.parse(req.body.payload)
        : req.body.payload;
    } else if (typeof req.body === 'string') {
      // raw string인 경우
      const params = new URLSearchParams(req.body);
      payload = JSON.parse(params.get('payload') || '{}');
    } else {
      // body 전체가 payload인 경우
      payload = req.body;
    }

    console.log('Slack payload type:', payload?.type);
    console.log('Slack actions:', JSON.stringify(payload?.actions));

    // Slack URL 검증 요청 처리 (Interactivity 설정 시 1회 발생)
    if (payload?.type === 'url_verification') {
      return res.status(200).json({ challenge: payload.challenge });
    }

    const action     = payload?.actions?.[0];
    const actionId   = action?.action_id;
    const actionData = JSON.parse(action?.value || '{}');
    const { userId, userEmail, userName } = actionData;
    const responseUrl = payload?.response_url;

    console.log('actionId:', actionId, 'userId:', userId, 'userEmail:', userEmail);

    if (!actionId || !responseUrl) {
      console.error('필수 데이터 없음:', { actionId, responseUrl });
      return res.status(200).end(); // Slack에는 200 반환
    }

    // ── 승인 처리 ──
    if (actionId === 'approve_premium') {
      const expiry = new Date();
      expiry.setMonth(expiry.getMonth() + 1);

      const { error } = await supabase
        .from('users')
        .update({
          user_status: 'premium',
          expiry_date: expiry.toISOString()
        })
        .eq('email', userEmail);

      if (error) {
        console.error('DB 업데이트 실패:', error.message);
        // userId로 실패 시 email로 재시도
        const { error: error2 } = await supabase
          .from('users')
          .update({
            user_status: 'premium',
            expiry_date: expiry.toISOString()
          })
          .eq('email', userEmail);

        if (error2) throw new Error(error2.message);
      }

      await fetch(responseUrl, {
        method : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body   : JSON.stringify({
          replace_original: true,
          blocks: [{
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `✅ *승인 완료*\n*${userName || userEmail}* (${userEmail}) 님이 Premium으로 변경되었습니다.\n만료일: ${expiry.toLocaleDateString('ko-KR')}`
            }
          }]
        })
      });
    }

    // ── 거절 처리 ──
    if (actionId === 'reject_premium') {
      await fetch(responseUrl, {
        method : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body   : JSON.stringify({
          replace_original: true,
          blocks: [{
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `❌ *거절됨*\n*${userName || userEmail}* (${userEmail}) 님의 신청이 거절되었습니다.`
            }
          }]
        })
      });
    }

    // Slack은 3초 내에 200 응답을 받아야 함
    res.status(200).end();

  } catch (error) {
    console.error('slack-action error:', error.message);
    res.status(200).end(); // 오류가 있어도 Slack에는 200 반환
  }
}
