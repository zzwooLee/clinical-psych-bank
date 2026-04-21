// slack-action.js
// Vercel은 bodyParser:false를 functions 설정에서 지원하지 않으므로
// 파싱된 req.body를 다시 urlencoded 문자열로 재구성해 서명 검증합니다.
// Slack이 전송하는 형식: application/x-www-form-urlencoded
//   → Vercel이 파싱 → req.body = { payload: '{"type":"block_actions",...}' }
// 재구성: "payload=" + encodeURIComponent(req.body.payload)

import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// ─────────────────────────────────────────────
// [C-4] Slack 서명 검증
// Vercel이 body를 파싱한 후이므로 req.body를 재구성해 원본 문자열을 복원합니다.
// ─────────────────────────────────────────────
function verifySlackSignature(req) {
  const signingSecret = process.env.SLACK_SIGNING_SECRET;
  if (!signingSecret) {
    console.warn('[slack-action] SLACK_SIGNING_SECRET 미설정 — 서명 검증 생략');
    return true;
  }

  const timestamp = req.headers['x-slack-request-timestamp'];
  const slackSig  = req.headers['x-slack-signature'];
  if (!timestamp || !slackSig) {
    console.error('[slack-action] 서명 헤더 없음');
    return false;
  }

  // Replay attack 방지: 5분 초과 요청 거부
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) {
    console.warn('[slack-action] 타임스탬프 5분 초과');
    return false;
  }

  // req.body를 urlencoded 문자열로 재구성
  // Slack이 보내는 body는 항상 payload=<JSON문자열> 형태
  let rawBody;
  if (req.body && typeof req.body.payload === 'string') {
    // Vercel이 파싱한 경우: payload 값을 다시 인코딩
    rawBody = 'payload=' + encodeURIComponent(req.body.payload);
  } else if (typeof req.body === 'string') {
    rawBody = req.body;
  } else {
    // 객체인 경우 전체 재구성
    rawBody = Object.entries(req.body || {})
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join('&');
  }

  const baseString = `v0:${timestamp}:${rawBody}`;
  const expected   = 'v0=' + crypto
    .createHmac('sha256', signingSecret)
    .update(baseString)
    .digest('hex');

  if (expected.length !== slackSig.length) return false;

  try {
    return crypto.timingSafeEqual(
      Buffer.from(expected, 'utf8'),
      Buffer.from(slackSig,  'utf8')
    );
  } catch {
    return false;
  }
}

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
    else       console.log('[slack-action] 메일 발송 성공:', data.id, '->', to);
  } catch (e) {
    console.error('[slack-action] 메일 발송 예외:', e.message);
  }
}

// ─────────────────────────────────────────────
// 핸들러
// ─────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  // [C-4] 서명 검증
  if (!verifySlackSignature(req)) {
    console.error('[slack-action] 서명 검증 실패');
    return res.status(401).end();
  }

  try {
    // payload 파싱
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

    // Slack URL 검증 (최초 엔드포인트 등록 시)
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

    console.log('[slack-action] actionId:', actionId, '/ email:', userEmail);

    if (!actionId || !responseUrl) {
      console.error('[slack-action] 필수값 없음');
      return res.status(200).end();
    }

    // ── 승인 처리 ──────────────────────────────────────
    if (actionId === 'approve_premium') {
      const expiry = new Date();
      expiry.setMonth(expiry.getMonth() + 1);
      const expiryStr = expiry.toLocaleDateString('ko-KR');

      // id로 먼저 시도, 실패 시 email로 재시도
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

      await fetch(responseUrl, {
        method : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body   : JSON.stringify({
          replace_original: true,
          blocks: [{ type: 'section', text: { type: 'mrkdwn',
            text: `✅ *Premium 승인 완료*\n${userName || userEmail} (${userEmail})\n만료일: ${expiryStr}`
          }}]
        })
      });
    }

    // ── 거절 처리 ──────────────────────────────────────
    if (actionId === 'reject_premium') {
      await sendEmail({
        to     : userEmail,
        subject: `[${serviceName}] 프리미엄 신청 결과 안내`,
        html   : `<div style="font-family:sans-serif;font-size:11pt;padding:30px;border:1px solid #e2e8f0;border-radius:12px;">
          <h2 style="color:#e53e3e;margin-bottom:10px;">프리미엄 신청 안내</h2>
          <p style="color:#4a5568;line-height:1.7;">안녕하세요, <strong>${userName || userEmail}</strong>님.<br>신청하신 프리미엄 멤버십 처리 중 문제가 발생했습니다.<br>입금 내역을 확인 후 아래로 문의해주시면 빠르게 처리해드리겠습니다.</p>
          <p style="font-size:0.9rem;color:#718096;line-height:1.7;">문의: <a href="mailto:${adminEmail}" style="color:#364d79;">${adminEmail}</a></p>
        </div>`
      });

      await fetch(responseUrl, {
        method : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body   : JSON.stringify({
          replace_original: true,
          blocks: [{ type: 'section', text: { type: 'mrkdwn',
            text: `❌ *신청 거절*: ${userName || userEmail} (${userEmail})`
          }}]
        })
      });
    }

    // Slack은 3초 내 200 응답 필요
    return res.status(200).end();

  } catch (error) {
    console.error('[slack-action] 처리 오류:', error.message);
    return res.status(200).end(); // 오류여도 200 반환 (Slack 재시도 방지)
  }
}
