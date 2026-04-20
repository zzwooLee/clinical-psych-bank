// Slack 버튼 클릭 시 호출되는 엔드포인트
// Slack → POST /api/slack-action → DB 등급 변경 → Slack 메시지 업데이트

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
    // Slack은 payload를 application/x-www-form-urlencoded로 전송
    const rawPayload = req.body?.payload || '';
    const payload    = JSON.parse(decodeURIComponent(rawPayload));

    // Slack 요청 검증 (서명 확인)
    const signingSecret = process.env.SLACK_SIGNING_SECRET;
    const slackSig      = req.headers['x-slack-signature'] || '';
    const slackTimestamp = req.headers['x-slack-request-timestamp'] || '';

    // 재전송 공격 방지 (5분 이상 된 요청 거부)
    if (Math.abs(Date.now() / 1000 - Number(slackTimestamp)) > 300) {
      return res.status(400).json({ message: '요청이 만료되었습니다.' });
    }

    // HMAC 서명 검증
    const crypto   = await import('crypto');
    const sigBase  = `v0:${slackTimestamp}:${req.rawBody || ''}`;
    const mySign   = 'v0=' + crypto.default
      .createHmac('sha256', signingSecret)
      .update(sigBase)
      .digest('hex');

    if (mySign !== slackSig) {
      return res.status(401).json({ message: '인증 실패' });
    }

    const action      = payload.actions?.[0];
    const actionId    = action?.action_id;
    const actionData  = JSON.parse(action?.value || '{}');
    const { userId, userEmail, userName } = actionData;
    const responseUrl = payload.response_url;  // 메시지 업데이트용 URL

    // ── 승인 처리 ──
    if (actionId === 'approve_premium') {
      // 만료일: 오늘로부터 1개월
      const expiry = new Date();
      expiry.setMonth(expiry.getMonth() + 1);

      const { error } = await supabase
        .from('users')
        .update({
          user_status: 'premium',
          expiry_date: expiry.toISOString()
        })
        .eq('id', userId);

      if (error) throw new Error(error.message);

      // Slack 메시지를 완료 상태로 업데이트
      await fetch(responseUrl, {
        method : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body   : JSON.stringify({
          replace_original: true,
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `✅ *승인 완료*\n*${userName || userEmail}* (${userEmail}) 님이 Premium으로 변경되었습니다.\n만료일: ${expiry.toLocaleDateString('ko-KR')}`
              }
            }
          ]
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
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `❌ *거절됨*\n*${userName || userEmail}* (${userEmail}) 님의 신청이 거절되었습니다.`
              }
            }
          ]
        })
      });
    }

    // Slack은 200 응답을 즉시 받아야 함
    res.status(200).end();

  } catch (error) {
    console.error('slack-action error:', error.message);
    res.status(500).end();
  }
}
