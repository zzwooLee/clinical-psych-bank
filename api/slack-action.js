// slack-action.js
// [C-4] 수정: Slack Signing Secret 서명 검증 추가.
//             서명 불일치 또는 타임스탬프 5분 초과 요청 → 즉시 401 반환.
//             이로써 외부에서 /api/slack-action을 직접 POST해 승인을 위조하는 것을 방지합니다.
//
// ⚠️  중요: Vercel에서 Slack 서명 검증을 하려면 raw body(원본 바이트)가 필요합니다.
//     vercel.json 또는 Vercel 대시보드에서 해당 함수의 body parser를 비활성화해야 합니다.
//
//     vercel.json에 아래 설정을 추가하세요:
//     {
//       "functions": {
//         "api/slack-action.js": { "bodyParser": false }
//       }
//     }
//
//     그래야 아래 getRawBody() 함수로 원본 바이트를 읽을 수 있습니다.

import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// ─────────────────────────────────────────────────────────────────
// [C-4] raw body를 Buffer로 읽는 헬퍼
// bodyParser: false 설정 시 req는 ReadableStream입니다.
// ─────────────────────────────────────────────────────────────────
function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end',  ()    => resolve(Buffer.concat(chunks)));
    req.on('error', err  => reject(err));
  });
}

// ─────────────────────────────────────────────────────────────────
// [C-4] Slack 서명 검증
// 공식 문서: https://api.slack.com/authentication/verifying-requests-from-slack
// ─────────────────────────────────────────────────────────────────
function verifySlackSignature(rawBody, req) {
  const signingSecret = process.env.SLACK_SIGNING_SECRET;
  if (!signingSecret) {
    console.error('[slack-action] SLACK_SIGNING_SECRET 환경변수 누락');
    return false;
  }

  const timestamp = req.headers['x-slack-request-timestamp'];
  const slackSig  = req.headers['x-slack-signature'];

  if (!timestamp || !slackSig) return false;

  // Replay attack 방지: 요청 시각이 5분 이상 경과했으면 거부
  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - Number(timestamp)) > 300) {
    console.warn('[slack-action] 타임스탬프 검증 실패 — replay attack 의심');
    return false;
  }

  // HMAC-SHA256 서명 생성
  const baseString = `v0:${timestamp}:${rawBody.toString('utf8')}`;
  const expected   = 'v0=' + crypto
    .createHmac('sha256', signingSecret)
    .update(baseString)
    .digest('hex');

  // timing-safe 비교로 타이밍 공격 방지
  try {
    return crypto.timingSafeEqual(
      Buffer.from(expected, 'utf8'),
      Buffer.from(slackSig, 'utf8')
    );
  } catch {
    return false; // 길이가 달라 timingSafeEqual이 throw하는 경우
  }
}

// ─────────────────────────────────────────────────────────────────
// Resend 메일 발송 함수
// ─────────────────────────────────────────────────────────────────
async function sendEmail({ to, subject, html }) {
  const resendKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.MAIL_FROM || 'onboarding@resend.dev';

  if (!resendKey) {
    console.error('[slack-action] RESEND_API_KEY 환경변수 누락');
    return;
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method : 'POST',
      headers: {
        'Content-Type' : 'application/json',
        'Authorization': `Bearer ${resendKey}`
      },
      body: JSON.stringify({ from: fromEmail, to, subject, html })
    });

    const data = await res.json();
    if (!res.ok) {
      console.error('[slack-action] Resend 오류:', JSON.stringify(data));
    } else {
      console.log('[slack-action] 메일 발송 성공:', data.id, '->', to);
    }
  } catch (e) {
    console.error('[slack-action] 메일 발송 오류:', e.message);
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).end();
  }

  // [C-4] raw body 읽기 (bodyParser: false 필수)
  let rawBody;
  try {
    rawBody = await getRawBody(req);
  } catch (e) {
    console.error('[slack-action] raw body 읽기 실패:', e.message);
    return res.status(400).end();
  }

  // [C-4] Slack 서명 검증 — 실패 시 즉시 401 반환
  if (!verifySlackSignature(rawBody, req)) {
    console.error('[slack-action] Slack 서명 검증 실패 — 무효한 요청');
    return res.status(401).json({ message: 'Invalid Slack signature' });
  }

  try {
    // bodyParser: false 이므로 rawBody를 직접 파싱
    const rawStr = rawBody.toString('utf8');

    let payload;
    // Slack은 application/x-www-form-urlencoded로 payload를 전송합니다.
    const params = new URLSearchParams(rawStr);
    const payloadStr = params.get('payload');
    if (payloadStr) {
      payload = JSON.parse(payloadStr);
    } else {
      // JSON 요청 (url_verification 등)
      try { payload = JSON.parse(rawStr); } catch { payload = {}; }
    }

    // Slack URL 검증 (초기 엔드포인트 등록 시)
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

    console.log('[slack-action] 처리 시작:', actionId, userEmail);

    if (!actionId || !responseUrl) {
      console.error('[slack-action] 필수값 없음 — actionId 또는 responseUrl 누락');
      return res.status(200).end();
    }

    // ────────────────────────────────────────────────
    // 승인 처리
    // ────────────────────────────────────────────────
    if (actionId === 'approve_premium') {
      const expiry = new Date();
      expiry.setMonth(expiry.getMonth() + 1);
      const expiryStr = expiry.toLocaleDateString('ko-KR');

      // DB 업데이트 (id로 시도, 실패 시 email로 재시도)
      const { error } = await supabase
        .from('users')
        .update({ user_status: 'premium', expiry_date: expiry.toISOString() })
        .eq('id', userId);

      if (error) {
        console.error('[slack-action] DB 업데이트 실패 (id):', error.message);
        const { error: error2 } = await supabase
          .from('users')
          .update({ user_status: 'premium', expiry_date: expiry.toISOString() })
          .eq('email', userEmail);
        if (error2) {
          console.error('[slack-action] DB 업데이트 실패 (email):', error2.message);
        } else {
          console.log('[slack-action] DB 업데이트 성공 (email)');
        }
      } else {
        console.log('[slack-action] DB 업데이트 성공 (id)');
      }

      // 승인 안내 메일 발송
      await sendEmail({
        to     : userEmail,
        subject: `[${serviceName}] 프리미엄 멤버십이 활성화되었습니다`,
        html   : `
          <div style="font-family:sans-serif;font-size:11pt;padding:30px;
                      border:1px solid #e2e8f0;border-radius:12px;">
            <h2 style="color:#364d79;margin-bottom:10px;">프리미엄 멤버십 활성화</h2>
            <p style="color:#4a5568;line-height:1.7;">
              안녕하세요, <strong>${userName || userEmail}</strong>님.<br>
              입금이 확인되어 프리미엄 멤버십이 활성화되었습니다.
            </p>
            <div style="background:#f0f4ff;border-left:4px solid #364d79;
                        padding:16px 20px;margin:20px 0;border-radius:4px 12px 12px 4px;">
              <p style="margin:0;font-size:0.95rem;color:#2d3748;">
                등급: <strong>Premium</strong><br>
                만료일: <strong>${expiryStr}</strong>
              </p>
            </div>
            <p style="font-size:0.9rem;color:#718096;line-height:1.7;">
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
              text: `✅ *Premium 승인 완료*\n${userName || userEmail} (${userEmail})\n만료일: ${expiryStr}`
            }
          }]
        })
      });
    }

    // ────────────────────────────────────────────────
    // 거절 처리
    // ────────────────────────────────────────────────
    if (actionId === 'reject_premium') {
      await sendEmail({
        to     : userEmail,
        subject: `[${serviceName}] 프리미엄 신청 결과 안내`,
        html   : `
          <div style="font-family:sans-serif;font-size:11pt;padding:30px;
                      border:1px solid #e2e8f0;border-radius:12px;">
            <h2 style="color:#e53e3e;margin-bottom:10px;">프리미엄 신청 안내</h2>
            <p style="color:#4a5568;line-height:1.7;">
              안녕하세요, <strong>${userName || userEmail}</strong>님.<br>
              신청하신 프리미엄 멤버십 처리 중 문제가 발생했습니다.<br>
              입금 내역을 확인 후 아래로 문의해주시면 빠르게 처리해드리겠습니다.
            </p>
            <p style="font-size:0.9rem;color:#718096;line-height:1.7;">
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
              text: `❌ *신청 거절*: ${userName || userEmail} (${userEmail})`
            }
          }]
        })
      });
    }

    return res.status(200).end();

  } catch (error) {
    console.error('[slack-action] 처리 오류:', error.message);
    // Slack에는 항상 200 반환 (그래야 재시도를 하지 않음)
    return res.status(200).end();
  }
}
