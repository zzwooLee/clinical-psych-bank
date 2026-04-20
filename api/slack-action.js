// Slack 버튼 클릭 처리 -> DB 등급 변경 -> Resend로 메일 발송

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// Resend 메일 발송 함수
async function sendEmail({ to, subject, html }) {
  const resendKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.MAIL_FROM || 'onboarding@resend.dev';

  if (!resendKey) {
    console.error('RESEND_API_KEY 환경변수 누락');
    return;
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + resendKey
      },
      body: JSON.stringify({ from: fromEmail, to, subject, html })
    });

    const data = await res.json();
    if (!res.ok) {
      console.error('Resend 오류:', JSON.stringify(data));
    } else {
      console.log('메일 발송 성공:', data.id, '->', to);
    }
  } catch (e) {
    console.error('메일 발송 오류:', e.message);
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).end();
  }

  try {
    // Slack payload 파싱
    let payload;
    if (req.body && req.body.payload) {
      payload = typeof req.body.payload === 'string'
        ? JSON.parse(req.body.payload)
        : req.body.payload;
    } else if (typeof req.body === 'string') {
      const params = new URLSearchParams(req.body);
      payload = JSON.parse(params.get('payload') || '{}');
    } else {
      payload = req.body;
    }

    if (payload && payload.type === 'url_verification') {
      return res.status(200).json({ challenge: payload.challenge });
    }

    const action      = payload && payload.actions && payload.actions[0];
    const actionId    = action && action.action_id;
    const actionData  = JSON.parse((action && action.value) || '{}');
    const userId      = actionData.userId;
    const userEmail   = actionData.userEmail;
    const userName    = actionData.userName;
    const responseUrl = payload && payload.response_url;
    const adminEmail  = process.env.ADMIN_EMAIL;
    const serviceName = '임상심리사 퀴즈 뱅크';

    console.log('처리 시작:', actionId, userEmail);

    if (!actionId || !responseUrl) {
      console.error('필수값 없음');
      return res.status(200).end();
    }

    // 승인 처리
    if (actionId === 'approve_premium') {
      const expiry = new Date();
      expiry.setMonth(expiry.getMonth() + 1);
      const expiryStr = expiry.toLocaleDateString('ko-KR');

      // DB 업데이트 (id로 시도, 실패시 email로 재시도)
      const { error } = await supabase
        .from('users')
        .update({ user_status: 'premium', expiry_date: expiry.toISOString() })
        .eq('id', userId);

      if (error) {
        console.error('DB 업데이트 실패 (id):', error.message);
        const { error: error2 } = await supabase
          .from('users')
          .update({ user_status: 'premium', expiry_date: expiry.toISOString() })
          .eq('email', userEmail);
        if (error2) {
          console.error('DB 업데이트 실패 (email):', error2.message);
        } else {
          console.log('DB 업데이트 성공 (email)');
        }
      } else {
        console.log('DB 업데이트 성공 (id)');
      }

      // 승인 메일 발송
      await sendEmail({
        to: userEmail,
        subject: '[' + serviceName + '] 프리미엄 멤버십이 활성화되었습니다',
        html: '<div style="font-family:sans-serif;font-size:11pt;padding:30px;border:1px solid #e2e8f0;border-radius:12px;">'
          + '<h2 style="color:#364d79;margin-bottom:10px;">프리미엄 멤버십 활성화</h2>'
          + '<p style="color:#4a5568;line-height:1.7;">안녕하세요, <strong>' + (userName || userEmail) + '</strong>님.<br>입금이 확인되어 프리미엄 멤버십이 활성화되었습니다.</p>'
          + '<div style="background:#f0f4ff;border-left:4px solid #364d79;padding:16px 20px;margin:20px 0;border-radius:4px 12px 12px 4px;">'
          + '<p style="margin:0;font-size:0.95rem;color:#2d3748;">등급: <strong>Premium</strong><br>만료일: <strong>' + expiryStr + '</strong></p>'
          + '</div>'
          + '<p style="font-size:0.9rem;color:#718096;line-height:1.7;">이제 모든 기출문제와 AI 예상 문제를 이용하실 수 있습니다.<br>문의: <a href="mailto:' + adminEmail + '" style="color:#364d79;">' + adminEmail + '</a></p>'
          + '</div>'
      });

      // Slack 메시지 업데이트
      await fetch(responseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          replace_original: true,
          blocks: [{
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: '*승인 완료*\n*' + (userName || userEmail) + '* (' + userEmail + ') 님이 Premium으로 변경되었습니다.\n만료일: ' + expiryStr + '\n메일 발송 완료'
            }
          }]
        })
      });
    }

    // 거절 처리
    if (actionId === 'reject_premium') {
      await sendEmail({
        to: userEmail,
        subject: '[' + serviceName + '] 프리미엄 신청 결과 안내',
        html: '<div style="font-family:sans-serif;font-size:11pt;padding:30px;border:1px solid #e2e8f0;border-radius:12px;">'
          + '<h2 style="color:#e53e3e;margin-bottom:10px;">프리미엄 신청 안내</h2>'
          + '<p style="color:#4a5568;line-height:1.7;">안녕하세요, <strong>' + (userName || userEmail) + '</strong>님.<br>신청하신 프리미엄 멤버십 처리 중 문제가 발생했습니다.<br>입금 내역을 확인 후 아래로 문의해주시면 빠르게 처리해드리겠습니다.</p>'
          + '<p style="font-size:0.9rem;color:#718096;line-height:1.7;">문의: <a href="mailto:' + adminEmail + '" style="color:#364d79;">' + adminEmail + '</a></p>'
          + '</div>'
      });

      // Slack 메시지 업데이트
      await fetch(responseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          replace_original: true,
          blocks: [{
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: '*거절됨*\n*' + (userName || userEmail) + '* (' + userEmail + ') 님의 신청이 거절되었습니다.\n메일 발송 완료'
            }
          }]
        })
      });
    }

    res.status(200).end();

  } catch (error) {
    console.error('slack-action 오류:', error.message);
    res.status(200).end();
  }
}
