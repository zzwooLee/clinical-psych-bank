// send-mail.js
// ─────────────────────────────────────────────────────────────────
// 수정 이력
// [FIX-High-1] actionValue JSON.stringify 전 userName null/undefined 정제
//              profile 조회 실패 시 undefined가 직렬화되어 Slack 메시지에
//              "undefined" 문자열이 표시되거나 slack-action.js에서 파싱 오류 발생
//              → userName: userName || '' 로 명시적 빈 문자열 폴백 적용
// [기존 유지]  JWT 인증 — 비인증 사용자의 임의 Slack 알림 발송 차단
// [기존 유지]  본인 이메일 강제 사용 — body 값 신뢰 안 함
// [기존 유지]  이미 premium/admin인 사용자 중복 신청 차단
// ─────────────────────────────────────────────────────────────────

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// ─────────────────────────────────────────────────────────────────
// JWT 검증 헬퍼
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
      // [FIX-High-1] null/undefined 방지 — 빈 문자열로 정규화
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

  // JWT 인증 검증 — 비인증 접근 차단
  const verified = await verifyUser(req);
  if (!verified) {
    return res.status(401).json({ message: 'Unauthorized: 로그인 후 이용해주세요.' });
  }

  // 이미 premium 또는 admin인 사용자의 중복 신청 차단
  // 클라이언트에서 버튼을 숨기더라도 서버에서 강제 검증합니다.
  if (verified.userStatus !== 'free') {
    console.log('[send-mail.js] 중복 신청 차단 — 현재 등급:', verified.userStatus, '/', verified.email);
    return res.status(400).json({ message: '이미 프리미엄 또는 관리자 계정입니다.' });
  }

  // 이메일과 이름은 JWT에서 검증된 값을 사용 — body 값은 신뢰하지 않음
  const userEmail = verified.email;
  const userId    = verified.id;
  // [FIX-High-1] verified.name은 verifyUser에서 이미 '' 로 정규화되어 있음
  const userName  = verified.name;

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
    const today = new Date().toLocaleDateString('ko-KR');

    // [FIX-High-1] userName이 null/undefined인 경우 JSON.stringify가
    // 해당 키를 생략하거나 "undefined" 문자열을 직렬화하는 문제 방지
    // verifyUser에서 이미 '' 처리되어 있으나 명시적으로 재확인합니다.
    const actionValue = JSON.stringify({
      userId,
      userEmail,
      userName: userName || ''
    });

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
