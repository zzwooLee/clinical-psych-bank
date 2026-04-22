// send-mail.js
// [FIX-1] JWT 인증 추가 — 비인증 사용자의 임의 Slack 알림 발송 차단
// [FIX-2] 본인 이메일 강제 사용 — body의 userEmail 대신 JWT에서 확인한 이메일 사용
//         (타인 이메일로 신청하는 공격 방지)
// [FIX-3] verifyUser 헬퍼 추가 (questions.js / admin.js와 동일한 패턴)

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// ─────────────────────────────────────────────────────────────────
// [FIX-1] JWT 검증 헬퍼
// ─────────────────────────────────────────────────────────────────
async function verifyUser(req) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) return null;

    const token = authHeader.split(' ')[1];

    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) {
      console.warn('[send-mail.js] JWT 검증 실패:', error?.message);
      return null;
    }

    const { data: profile, error: profileError } = await supabase
      .from('users')
      .select('id, email, name, user_status')
      .eq('id', user.id)
      .single();

    if (profileError || !profile) {
      console.warn('[send-mail.js] users 조회 실패:', profileError?.message);
      return null;
    }

    return {
      id        : profile.id,
      email     : profile.email || user.email,
      name      : profile.name  || '',
      userStatus: profile.user_status || 'free'
    };
  } catch (e) {
    console.warn('[send-mail.js] verifyUser 예외:', e.message);
    return null;
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method Not Allowed' });
  }

  // [FIX-High-②] JWT 인증 검증 — 비인증 접근 차단
  const verified = await verifyUser(req);
  if (!verified) {
    return res.status(401).json({ message: 'Unauthorized: 로그인 후 이용해주세요.' });
  }

  // [FIX-High-②] 이미 premium 또는 admin인 사용자의 중복 신청 차단
  // · 클라이언트에서 버튼을 숨기더라도 서버에서 강제 검증합니다.
  // · 중복 신청 시 Slack 스팸 및 관리자 혼선을 방지합니다.
  if (verified.userStatus !== 'free') {
    console.log('[send-mail.js] 중복 신청 차단 — 현재 등급:', verified.userStatus, '/', verified.email);
    return res.status(400).json({ message: '이미 프리미엄 또는 관리자 계정입니다.' });
  }

  // [FIX-2] 이메일과 이름은 JWT에서 검증된 값을 사용 — body 값은 신뢰하지 않음
  const userEmail = verified.email;
  const userName  = verified.name;
  const userId    = verified.id;

  if (!userEmail) {
    return res.status(400).json({ message: '사용자 이메일 정보를 가져올 수 없습니다.' });
  }

  const slackToken   = process.env.SLACK_BOT_TOKEN;
  const slackChannel = process.env.SLACK_CHANNEL_ID;

  const missing = [];
  if (!slackToken)   missing.push('SLACK_BOT_TOKEN');
  if (!slackChannel) missing.push('SLACK_CHANNEL_ID');
  if (missing.length > 0) {
    return res.status(500).json({
      message: `환경변수 누락: ${missing.join(', ')}`
    });
  }

  try {
    const today       = new Date().toLocaleDateString('ko-KR');
    const actionValue = JSON.stringify({ userId, userEmail, userName });

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

    const slackRes  = await fetch('https://slack.com/api/chat.postMessage', {
      method : 'POST',
      headers: {
        'Content-Type' : 'application/json',
        'Authorization': `Bearer ${slackToken}`
      },
      body: JSON.stringify(slackBody)
    });

    const slackData = await slackRes.json();
    console.log('Slack response:', JSON.stringify(slackData));

    if (!slackData.ok) {
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
