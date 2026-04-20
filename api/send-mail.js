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

  const slackToken   = process.env.SLACK_BOT_TOKEN;
  const slackChannel = process.env.SLACK_CHANNEL_ID;

  // ── 환경변수 누락 체크 ──
  const missing = [];
  if (!slackToken)   missing.push('SLACK_BOT_TOKEN');
  if (!slackChannel) missing.push('SLACK_CHANNEL_ID');
  if (missing.length > 0) {
    return res.status(500).json({
      message: `환경변수 누락: ${missing.join(', ')}`
    });
  }

  try {
    // ── Supabase에서 userId 조회 ──
    const { data: userRows, error: dbError } = await supabase
      .from('users')
      .select('id')
      .eq('email', userEmail)
      .limit(1);

    if (dbError) throw new Error(`DB 조회 실패: ${dbError.message}`);

    const userId      = userRows?.[0]?.id || '';
    const today       = new Date().toLocaleDateString('ko-KR');
    const actionValue = JSON.stringify({ userId, userEmail, userName });

    // Slack 메시지 구성
    const slackBody = {
      channel: slackChannel,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `⭐ *프리미엄 멤버십*\n${userName || '이름없음'}(${userEmail}) - ${today} 신청`
          }
        },
        {
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

    // ── Slack API 호출 ──
    const slackRes  = await fetch('https://slack.com/api/chat.postMessage', {
      method : 'POST',
      headers: {
        'Content-Type' : 'application/json',
        'Authorization': `Bearer ${slackToken}`
      },
      body: JSON.stringify(slackBody)
    });

    const slackData = await slackRes.json();

    // Slack 응답 전체를 로그로 출력 (Vercel 로그에서 확인 가능)
    console.log('Slack response:', JSON.stringify(slackData));

    if (!slackData.ok) {
      // Slack 오류 코드를 그대로 반환
      return res.status(500).json({
        message: `Slack 오류: ${slackData.error}`,
        detail : slackData
      });
    }

    res.status(200).json({ message: '신청이 완료되었습니다.' });

  } catch (error) {
    console.error('send-mail error:', error.message);
    res.status(500).json({ message: error.message });
  }
}
