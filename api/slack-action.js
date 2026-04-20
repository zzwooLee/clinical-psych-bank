// Slack 버튼 클릭 처리 → DB 등급 변경 → SMTP로 신청자에게 메일 발송

import { createClient } from '@supabase/supabase-js';
import nodemailer       from 'nodemailer';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// ── SMTP 메일 발송 함수 ──
async function sendEmail({ to, subject, html }) {
  const smtpHost = process.env.SMTP_HOST;
  const smtpPort = parseInt(process.env.SMTP_PORT || '465');
  const smtpUser = process.env.SMTP_USER;  // bee@lumoslab.kr
  const smtpPass = process.env.SMTP_PASSWORD;

  if (!smtpHost || !smtpUser || !smtpPass) {
    console.warn('SMTP 환경변수 미설정 — 메일 발송 건너뜀');
    return;
  }

  const transporter = nodemailer.createTransport({
    host  : smtpHost,
    port  : smtpPort,
    secure: smtpPort === 465,  // 465는 SSL, 587은 TLS
    auth  : { user: smtpUser, pass: smtpPass }
  });

  const info = await transporter.sendMail({
    from   : `임상심리사 퀴즈 뱅크 <${smtpUser}>`,
    to,
    subject,
    html
  });

  console.log('메일 발송 성공:', info.messageId);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).end();
  }

  try {
    // ── Slack payload 파싱 ──
    let payload;
    if (req.body?.payload) {
      payload = typeof req.body.payload === 'string'
        ? JSON.parse(req.body.payload)
        : req.body.payload;
    } else if (typeof req.body === 'string') {
      const params = new URLSearchParams(req.body);
      payload = JSON.parse(params.get('payload') || '{}');
    } else {
      payload = req.body;
    }

    console.log('actionId:', payload?.actions?.[0]?.action_id);

    if (payload?.type === 'url_verification') {
      return res.status(200).json({ challenge: payload.challenge });
    }

    const action      = payload?.actions?.[0];
    const actionId    = action?.action_id;
    const actionData  = JSON.parse(action?.value || '{}');
    const { userId, userEmail, userName } = actionData;
    const responseUrl = payload?.response_url;
    const adminEmail  = process.env.SMTP_USER || 'bee@lumoslab.kr';
    const serviceName = '임상심리사 퀴즈 뱅크';

    if (!actionId || !responseUrl) {
      return res.status(200).end();
    }

    // ── 승인 처리 ──
    if (actionId === 'approve_premium') {
      const expiry = new Date();
      expiry.setMonth(expiry.getMonth() + 1);
      const expiryStr = expiry.toLocaleDateString('ko-KR');

      // DB 업데이트
      const { error } = await supabase
        .from('users')
        .update({ user_status: 'premium', expiry_date: expiry.toISOString() })
        .eq('id', userId);

      if (error) {
        const { error: error2 } = await supabase
          .from('users')
          .update({ user_status: 'premium', expiry_date: expiry.toISOString() })
          .eq('email', userEmail);
        if (error2) throw new Error(error2.message);
      }

      // 승인 메일 발송
      await sendEmail({
        to     : userEmail,
        subject: `[${serviceName}] 프리미엄 멤버십이 활성화되었습니다 🎉`,
        html   : `
          <div style="font-family:sans-serif; max-width:480px; margin:0 auto;
                      padding:30px; border:1px solid #e2e8f0; border-radius:12px;">
            <h2 style="color:#364d79; margin-bottom:10px;">🎉 프리미엄 멤버십 활성화</h2>
            <p style="color:#4a5568; line-height:1.7;">
              안녕하세요, <strong>${userName || userEmail}</strong>님.<br>
              입금이 확인되어 프리미엄 멤버십이 활성화되었습니다.
            </p>
            <div style="background:#f0f4ff; border-left:4px solid #364d79;
                        padding:16px 20px; margin:20px 0; border-radius:4px 12px 12px 4px;">
              <p style="margin:0; font-size:0.95rem; color:#2d3748;">
                ✅ 등급: <strong>Premium</strong><br>
                📅 만료일: <strong>${expiryStr}</strong>
              </p>
            </div>
            <p style="font-size:0.9rem; color:#718096; line-height:1.7;">
              이제 모든 기출문제와 AI 예상 문제를 이용하실 수 있습니다.<br>
              문의: <a href="mailto:${adminEmail}" style="color:#364d79;">${adminEmail}</a>
            </p>
          </div>
        `
      });

      // Slack 메시지 업데이트
      await fetch(responseUrl, {
        method : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body   : JSON.stringify({
          replace_original: true,
          blocks: [{
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `✅ *승인 완료*\n*${userName || userEmail}* (${userEmail}) 님이 Premium으로 변경되었습니다.\n만료일: ${expiryStr}\n📧 승인 메일 발송 완료`
            }
          }]
        })
      });
    }

    // ── 거절 처리 ──
    if (actionId === 'reject_premium') {

      // 거절 메일 발송
      await sendEmail({
        to     : userEmail,
        subject: `[${serviceName}] 프리미엄 신청 결과 안내`,
        html   : `
          <div style="font-family:sans-serif; max-width:480px; margin:0 auto;
                      padding:30px; border:1px solid #e2e8f0; border-radius:12px;">
            <h2 style="color:#e53e3e; margin-bottom:10px;">프리미엄 신청 안내</h2>
            <p style="color:#4a5568; line-height:1.7;">
              안녕하세요, <strong>${userName || userEmail}</strong>님.<br>
              신청하신 프리미엄 멤버십 처리 중 문제가 발생했습니다.<br>
              입금 내역을 확인 후 아래로 문의해주시면 빠르게 처리해드리겠습니다.
            </p>
            <p style="font-size:0.9rem; color:#718096; line-height:1.7;">
              문의: <a href="mailto:${adminEmail}" style="color:#364d79;">${adminEmail}</a>
            </p>
          </div>
        `
      });

      // Slack 메시지 업데이트
      await fetch(responseUrl, {
        method : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body   : JSON.stringify({
          replace_original: true,
          blocks: [{
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `❌ *거절됨*\n*${userName || userEmail}* (${userEmail}) 님의 신청이 거절되었습니다.\n📧 안내 메일 발송 완료`
            }
          }]
        })
      });
    }

    res.status(200).end();

  } catch (error) {
    console.error('slack-action error:', error.message);
    res.status(200).end();
  }
}
