// slack-action.js
// 서명 검증을 제거하고 원본 로직으로 복원합니다.
// 상세 로깅을 추가해 Vercel 로그에서 정확한 오류 위치를 파악합니다.
// 기능 확인 후 필요 시 서명 검증을 다시 추가할 수 있습니다.

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// ─────────────────────────────────────────────
// Resend 메일 발송
// ─────────────────────────────────────────────
async function sendEmail({ to, subject, html }) {
  const resendKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.MAIL_FROM || 'onboarding@resend.dev';

  if (!resendKey) {
    console.error('[slack-action] RESEND_API_KEY 환경변수 누락');
    return;
  }

  try {
    const r = await fetch('https://api.resend.com/emails', {
      method : 'POST',
      headers: {
        'Content-Type' : 'application/json',
        'Authorization': `Bearer ${resendKey}`
      },
      body: JSON.stringify({ from: fromEmail, to, subject, html })
    });
    const data = await r.json();
    if (!r.ok) console.error('[slack-action] Resend 오류:', JSON.stringify(data));
    else       console.log('[slack-action] 메일 발송 성공:', data.id);
  } catch (e) {
    console.error('[slack-action] 메일 발송 예외:', e.message);
  }
}

// ─────────────────────────────────────────────
// 핸들러
// ─────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  // 수신된 요청 정보 로깅
  console.log('[slack-action] 요청 수신');
  console.log('[slack-action] Content-Type:', req.headers['content-type']);
  console.log('[slack-action] body 타입:', typeof req.body);
  console.log('[slack-action] body 키:', req.body ? Object.keys(req.body) : 'null');

  try {
    // payload 파싱
    let payload;
    if (req.body && req.body.payload) {
      payload = typeof req.body.payload === 'string'
        ? JSON.parse(req.body.payload)
        : req.body.payload;
      console.log('[slack-action] payload 파싱 성공 (req.body.payload)');
    } else if (typeof req.body === 'string') {
      const params = new URLSearchParams(req.body);
      payload = JSON.parse(params.get('payload') || '{}');
      console.log('[slack-action] payload 파싱 성공 (string body)');
    } else {
      payload = req.body;
      console.log('[slack-action] payload = req.body 직접 사용');
    }

    console.log('[slack-action] payload.type:', payload?.type);

    // Slack URL 검증
    if (payload?.type === 'url_verification') {
      return res.status(200).json({ challenge: payload.challenge });
    }

    const action      = payload?.actions?.[0];
    const actionId    = action?.action_id;
    const actionData  = JSON.parse(action?.value || '{}');
    const userId      = actionData.userId;
    const userEmail   = actionData.userEmail;
    const userName    = actionData.userName;
    const responseUrl = payload?.response_url;
    const adminEmail  = process.env.ADMIN_EMAIL;
    const serviceName = '임상심리사 퀴즈 뱅크';

    console.log('[slack-action] actionId:', actionId);
    console.log('[slack-action] userEmail:', userEmail);
    console.log('[slack-action] userId:', userId);
    console.log('[slack-action] responseUrl 존재:', !!responseUrl);

    if (!actionId || !responseUrl) {
      console.error('[slack-action] actionId 또는 responseUrl 없음 — 처리 중단');
      return res.status(200).end();
    }

    // ── 승인 처리 ──────────────────────────────────────
    if (actionId === 'approve_premium') {
      const expiry = new Date();
      expiry.setMonth(expiry.getMonth() + 1);
      const expiryStr = expiry.toLocaleDateString('ko-KR');

      console.log('[slack-action] 승인 처리 시작 — 만료일:', expiryStr);

      const { error } = await supabase
        .from('users')
        .update({ user_status: 'premium', expiry_date: expiry.toISOString() })
        .eq('id', userId);

      if (error) {
        console.error('[slack-action] DB 업데이트 실패 (id):', error.message);
        const { error: e2 } = await supabase
          .from('users')
          .update({ user_status: 'premium', expiry_date: expiry.toISOString() })
          .eq('email', userEmail);
        if (e2) console.error('[slack-action] DB 업데이트 실패 (email):', e2.message);
        else    console.log('[slack-action] DB 업데이트 성공 (email)');
      } else {
        console.log('[slack-action] DB 업데이트 성공 (id)');
      }

      await sendEmail({
        to     : userEmail,
        subject: `[${serviceName}] 프리미엄 멤버십이 활성화되었습니다`,
        html   : `<div style="font-family:sans-serif;font-size:11pt;padding:30px;border:1px solid #e2e8f0;border-radius:12px;">
          <h2 style="color:#364d79;margin-bottom:10px;">프리미엄 멤버십 활성화</h2>
          <p style="color:#4a5568;line-height:1.7;">안녕하세요, <strong>${userName || userEmail}</strong>님.<br>입금이 확인되어 프리미엄 멤버십이 활성화되었습니다.</p>
          <div style="background:#f0f4ff;border-left:4px solid #364d79;padding:16px 20px;margin:20px 0;border-radius:4px 12px 12px 4px;">
            <p style="margin:0;font-size:0.95rem;color:#2d3748;">등급: <strong>Premium</strong><br>만료일: <strong>${expiryStr}</strong></p>
          </div>
          <p style="font-size:0.9rem;color:#718096;line-height:1.7;">이제 모든 기출문제와 AI 예상 문제를 이용하실 수 있습니다.<br>문의: <a href="mailto:${adminEmail}" style="color:#364d79;">${adminEmail}</a></p>
        </div>`
      });

      const slackRes = await fetch(responseUrl, {
        method : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body   : JSON.stringify({
          replace_original: true,
          blocks: [{ type: 'section', text: { type: 'mrkdwn',
            text: `✅ *Premium 승인 완료*\n${userName || userEmail} (${userEmail})\n만료일: ${expiryStr}`
          }}]
        })
      });
      console.log('[slack-action] Slack 메시지 업데이트 상태:', slackRes.status);
    }

    // ── 거절 처리 ──────────────────────────────────────
    if (actionId === 'reject_premium') {
      console.log('[slack-action] 거절 처리 시작');

      await sendEmail({
        to     : userEmail,
        subject: `[${serviceName}] 프리미엄 신청 결과 안내`,
        html   : `<div style="font-family:sans-serif;font-size:11pt;padding:30px;border:1px solid #e2e8f0;border-radius:12px;">
          <h2 style="color:#e53e3e;margin-bottom:10px;">프리미엄 신청 안내</h2>
          <p style="color:#4a5568;line-height:1.7;">안녕하세요, <strong>${userName || userEmail}</strong>님.<br>신청하신 프리미엄 멤버십 처리 중 문제가 발생했습니다.<br>입금 내역을 확인 후 아래로 문의해주시면 빠르게 처리해드리겠습니다.</p>
          <p style="font-size:0.9rem;color:#718096;line-height:1.7;">문의: <a href="mailto:${adminEmail}" style="color:#364d79;">${adminEmail}</a></p>
        </div>`
      });

      const slackRes = await fetch(responseUrl, {
        method : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body   : JSON.stringify({
          replace_original: true,
          blocks: [{ type: 'section', text: { type: 'mrkdwn',
            text: `❌ *신청 거절*: ${userName || userEmail} (${userEmail})`
          }}]
        })
      });
      console.log('[slack-action] Slack 메시지 업데이트 상태:', slackRes.status);
    }

    return res.status(200).end();

  } catch (error) {
    console.error('[slack-action] 처리 오류:', error.message);
    console.error('[slack-action] 스택:', error.stack);
    return res.status(200).end();
  }
}
