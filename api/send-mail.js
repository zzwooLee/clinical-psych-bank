// api/send-mail.js
// Slack 알림 메시지에 [✅ 승인] [❌ 거절] 버튼 포함
// Incoming Webhook 대신 Slack API chat.postMessage 사용 (버튼 응답을 위해 필요)

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method Not Allowed' });
  }

  const { userEmail, userName } = req.body;
  if (!userEmail) {
    return res.status(400).json({ message: '사용자 이메일이 없습니다.' });
  }

  const slackToken  = process.env.SLACK_BOT_TOKEN;   // Bot Token (xoxb-...)
  const slackChannel = process.env.SLACK_CHANNEL_ID; // 채널 ID (C0XXXXXXX)
  const priceAmount = process.env.PRICE_AMOUNT || '';
  const bankName    = process.env.BANK_NAME    || '';
  const bankAccount = process.env.BANK_ACCOUNT || '';
  const bankHolder  = process.env.BANK_HOLDER  || '';

  if (!slackToken || !slackChannel) {
    return res.status(500).json({ message: 'Slack 환경변수가 설정되지 않았습니다.' });
  }

  // Supabase에서 userEmail로 userId 조회
  const { data: userRows } = await supabase
    .from('users')
    .select('id')
    .eq('email', userEmail)
    .limit(1);

  const userId = userRows?.[0]?.id || '';
  const today  = new Date().toLocaleDateString('ko-KR');

  // 승인 버튼의 value에 userId와 userEmail을 담아 slack-action에서 사용
  const actionValue = JSON.stringify({ userId, userEmail, userName });

  const slackBody = {
    channel: slackChannel,
    blocks: [
      {
        type: 'header',
        text: { type: 'plain_text', text: '⭐ 프리미엄 멤버십 신청', emoji: true }
      },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*신청자 이름*\n${userName || '미입력'}` },
          { type: 'mrkdwn', text: `*신청 계정*\n${userEmail}` },
          { type: 'mrkdwn', text: `*신청 일자*\n${today}` },
          { type: 'mrkdwn', text: `*입금 금액*\n${priceAmount}` },
        ]
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*입금 계좌*\n${bankName}  \`${bankAccount}\`  (${bankHolder})`
        }
      },
      { type: 'divider' },
      {
        // 승인 / 거절 버튼
        type: 'actions',
        elements: [
          {
            type      : 'button',
            text      : { type: 'plain_text', text: '✅ 승인', emoji: true },
            style     : 'primary',
            action_id : 'approve_premium',
            value     : actionValue
          },
          {
            type      : 'button',
            text      : { type: 'plain_text', text: '❌ 거절', emoji: true },
            style     : 'danger',
            action_id : 'reject_premium',
            value     : actionValue
          }
        ]
      }
    ]
  };

  try {
    const slackRes = await fetch('https://slack.com/api/chat.postMessage', {
      method : 'POST',
      headers: {
        'Content-Type' : 'application/json',
        'Authorization': `Bearer ${slackToken}`
      },
      body: JSON.stringify(slackBody)
    });

    const slackData = await slackRes.json();
    if (!slackData.ok) throw new Error(`Slack 오류: ${slackData.error}`);

    res.status(200).json({ message: '신청이 완료되었습니다.' });

  } catch (error) {
    console.error('Slack notify error:', error.message);
    res.status(500).json({ message: `알림 발송 실패: ${error.message}` });
  }
}
