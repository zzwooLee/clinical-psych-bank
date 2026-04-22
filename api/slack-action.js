// slack-action.js
// [FIX-1] action.value JSON.parse 실패 시 개별 try/catch로 안전하게 처리 (기존 유지)
// [SEC-6] Slack 서명 검증(HMAC-SHA256) 유지
// [FIX-2] 승인 처리: DB 업데이트 성공 여부를 dbSuccess 플래그로 추적
//         id와 email 두 번의 fallback이 모두 실패하면 승인 메일 미발송 + Slack에 실패 표시
//         기존: 양쪽 모두 실패해도 승인 메일 발송 및 Slack "✅ 승인 완료" 표시 — 데이터 불일치
// [주의]  승인 만료일은 현재 1개월 고정입니다. 유연한 기간 처리가 필요하면
//         /api/update-expiry 엔드포인트 활용을 권장합니다.

import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// Vercel bodyParser 비활성화 — raw body로 Slack 서명 검증
export const config = {
  api: {
    bodyParser: false
  }
};

// ─────────────────────────────────────────────────────────────────
// raw body 읽기 헬퍼
// ─────────────────────────────────────────────────────────────────
function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end',  () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// ─────────────────────────────────────────────────────────────────
// Slack 서명 검증 (HMAC-SHA256)
// ─────────────────────────────────────────────────────────────────
function verifySlackSignature(rawBody, headers) {
  const signingSecret = process.env.SLACK_SIGNING_SECRET;
  if (!signingSecret) {
    console.error('[slack-action] SLACK_SIGNING_SECRET 환경변수 누락');
    return false;
  }

  const timestamp = headers['x-slack-request-timestamp'];
  const slackSig  = headers['x-slack-signature'];

  if (!timestamp || !slackSig) {
    console.warn('[slack-action] 서명 헤더 없음');
    return false;
  }

  // 재전송 공격 방지: 요청 시각이 5분 이상 차이나면 거부
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - parseInt(timestamp, 10)) > 300) {
    console.warn('[slack-action] 타임스탬프 오류 — 재전송 공격 가능성:', timestamp);
    return false;
  }

  const sigBaseString = `v0:${timestamp}:${rawBody.toString()}`;
  const hmac          = crypto.createHmac('sha256', signingSecret);
  hmac.update(sigBaseString);
  const mySignature = `v0=${hmac.digest('hex')}`;

  try {
    return crypto.timingSafeEqual(
      Buffer.from(mySignature, 'utf8'),
      Buffer.from(slackSig,    'utf8')
    );
  } catch {
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────
// Resend 메일 발송
// ─────────────────────────────────────────────────────────────────
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

// ─────────────────────────────────────────────────────────────────
// 핸들러
// ─────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  // raw body 읽기
  let rawBody;
  try {
    rawBody = await getRawBody(req);
  } catch (e) {
    console.error('[slack-action] raw body 읽기 실패:', e.message);
    return res.status(400).end();
  }

  // Slack 서명 검증
  if (!verifySlackSignature(rawBody, req.headers)) {
    console.error('[slack-action] 서명 검증 실패 — 요청 거부');
    return res.status(403).end();
  }

  const rawBodyStr = rawBody.toString('utf8');

  console.log('[slack-action] 요청 수신 (서명 검증 통과)');
  console.log('[slack-action] Content-Type:', req.headers['content-type']);

  try {
    // payload 파싱
    let payload;
    const contentType = req.headers['content-type'] || '';

    if (contentType.includes('application/x-www-form-urlencoded')) {
      const params     = new URLSearchParams(rawBodyStr);
      const payloadStr = params.get('payload');
      if (!payloadStr) {
        console.error('[slack-action] payload 파라미터 없음');
        return res.status(200).end();
      }
      payload = JSON.parse(payloadStr);
      console.log('[slack-action] payload 파싱 성공 (urlencoded)');
    } else if (contentType.includes('application/json')) {
      payload = JSON.parse(rawBodyStr);
      console.log('[slack-action] payload 파싱 성공 (json)');
    } else {
      try {
        const params     = new URLSearchParams(rawBodyStr);
        const payloadStr = params.get('payload');
        payload = payloadStr ? JSON.parse(payloadStr) : JSON.parse(rawBodyStr);
        console.log('[slack-action] payload 파싱 성공 (폴백)');
      } catch {
        console.error('[slack-action] payload 파싱 실패');
        return res.status(200).end();
      }
    }

    console.log('[slack-action] payload.type:', payload?.type);

    if (payload?.type === 'url_verification') {
      return res.status(200).json({ challenge: payload.challenge });
    }

    const action      = payload?.actions?.[0];
    const actionId    = action?.action_id;
    const responseUrl = payload?.response_url;
    const adminEmail  = process.env.ADMIN_EMAIL;
    const serviceName = '임상심리사 퀴즈 뱅크';

    // [FIX-1] action.value JSON.parse를 개별 try/catch로 감싸 안전하게 처리
    let actionData = {};
    try {
      actionData = JSON.parse(action?.value || '{}');
    } catch (parseErr) {
      console.error('[slack-action] action.value 파싱 실패:', parseErr.message, '/ raw value:', action?.value);
      return res.status(200).end();
    }

    const userId    = actionData.userId;
    const userEmail = actionData.userEmail;
    const userName  = actionData.userName;

    console.log('[slack-action] actionId:', actionId);
    console.log('[slack-action] userEmail:', userEmail);
    console.log('[slack-action] userId:', userId);
    console.log('[slack-action] responseUrl 존재:', !!responseUrl);

    if (!actionId || !responseUrl) {
      console.error('[slack-action] actionId 또는 responseUrl 없음 — 처리 중단');
      return res.status(200).end();
    }

    // ── 승인 처리 ──────────────────────────────────────────────
    if (actionId === 'approve_premium') {
      // [주의] 만료일은 현재 승인 시점 기준 1개월 고정입니다.
      // 유연한 기간 처리가 필요하면 /api/update-expiry 엔드포인트 활용을 권장합니다.
      const expiry    = new Date();
      expiry.setMonth(expiry.getMonth() + 1);
      const expiryStr = expiry.toLocaleDateString('ko-KR');

      console.log('[slack-action] 승인 처리 시작 — 만료일:', expiryStr);

      // [FIX-2] dbSuccess 플래그로 DB 업데이트 성공 여부를 추적합니다.
      // id와 email 두 번의 fallback이 모두 실패하면 승인 메일을 발송하지 않고
      // Slack 메시지도 실패로 표시하여 데이터 불일치를 방지합니다.
      let dbSuccess = false;

      const { error } = await supabase
        .from('users')
        .update({ user_status: 'premium', expiry_date: expiry.toISOString() })
        .eq('id', userId);

      if (!error) {
        dbSuccess = true;
        console.log('[slack-action] DB 업데이트 성공 (id)');
      } else {
        console.error('[slack-action] DB 업데이트 실패 (id):', error.message);

        // id로 실패 시 email로 재시도
        const { error: e2 } = await supabase
          .from('users')
          .update({ user_status: 'premium', expiry_date: expiry.toISOString() })
          .eq('email', userEmail);

        if (!e2) {
          dbSuccess = true;
          console.log('[slack-action] DB 업데이트 성공 (email fallback)');
        } else {
          console.error('[slack-action] DB 업데이트 실패 (email fallback):', e2.message);
        }
      }

      // [FIX-2] DB 업데이트 실패 시 메일 미발송 + Slack 실패 메시지 표시
      if (!dbSuccess) {
        console.error('[slack-action] DB 업데이트 최종 실패 — 승인 메일 미발송');
        await fetch(responseUrl, {
          method : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body   : JSON.stringify({
            replace_original: true,
            blocks: [{ type: 'section', text: { type: 'mrkdwn',
              text: `⚠️ *DB 업데이트 실패 — 수동 처리 필요*\n${userName || userEmail} (${userEmail})\n관리자 대시보드에서 직접 등급을 변경해주세요.`
            }}]
          })
        });
        return res.status(200).end();
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

    // ── 거절 처리 ──────────────────────────────────────────────
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
