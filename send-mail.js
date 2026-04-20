// api/send-mail.js
// 민감 정보는 모두 Vercel 환경변수에서 읽음
// GitHub에 노출되는 정보 없음

import { readFile } from 'fs/promises';
import { join }     from 'path';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method Not Allowed' });
  }

  const { userEmail, userName } = req.body;
  if (!userEmail) {
    return res.status(400).json({ message: '사용자 이메일이 없습니다.' });
  }

  // ── 민감 정보: 환경변수에서 읽기 ──
  const webhookUrl  = process.env.SLACK_WEBHOOK_URL;
  const bankName    = process.env.BANK_NAME;
  const bankAccount = process.env.BANK_ACCOUNT;
  const bankHolder  = process.env.BANK_HOLDER;
  const adminEmail  = process.env.ADMIN_EMAIL;

  if (!webhookUrl) {
    return res.status(500).json({ message: 'SLACK_WEBHOOK_URL 환경변수가 설정되지 않았습니다.' });
  }

  try {
    // ── 공개 정보: premium-info.json에서 읽기 ──
    const jsonPath    = join(process.cwd(), 'premium-info.json');
    const jsonText    = await readFile(jsonPath, 'utf-8');
    const info        = JSON.parse(jsonText);
    const priceAmount = info.price?.amount || '';
    const today       = new Date().toLocaleDateString('ko-KR');

    // ── Slack 메시지 구성 ──
    const slackBody = {
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
          type: 'context',
          elements: [{
            type: 'mrkdwn',
            text: '입금 확인 후 관리자 페이지에서 해당 계정을 *Premium* 으로 변경해주세요.'
          }]
        }
      ]
    };

    // ── Slack Webhook 호출 ──
    const slackRes = await fetch(webhookUrl, {
      method : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body   : JSON.stringify(slackBody)
    });

    if (!slackRes.ok) {
      const errText = await slackRes.text();
      throw new Error(`Slack 오류: ${errText}`);
    }

    res.status(200).json({ message: '신청이 완료되었습니다.' });

  } catch (error) {
    console.error('Slack notify error:', error.message);
    res.status(500).json({ message: `알림 발송 실패: ${error.message}` });
  }
}
