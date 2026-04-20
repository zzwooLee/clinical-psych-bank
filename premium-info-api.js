// premium-info.json(공개 정보) + 환경변수(민감 정보)를 합쳐서 반환
// 계좌번호, 이메일 등 민감 정보는 이 API를 통해서만 프론트에 전달됨

import { readFile } from 'fs/promises';
import { join }     from 'path';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method Not Allowed' });
  }

  try {
    // 공개 정보 — premium-info.json
    const jsonPath = join(process.cwd(), 'premium-info.json');
    const jsonText = await readFile(jsonPath, 'utf-8');
    const info     = JSON.parse(jsonText);

    // 민감 정보 — 환경변수에서 병합
    const merged = {
      ...info,
      bank: {
        label          : info.bank?.label || '입금 계좌',
        bank_name      : process.env.BANK_NAME    || '',
        account_number : process.env.BANK_ACCOUNT || '',
        account_holder : process.env.BANK_HOLDER  || '',
      },
      admin_email: process.env.ADMIN_EMAIL || '',
    };

    // 캐시 방지 (항상 최신 정보 반환)
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json(merged);

  } catch (error) {
    console.error('premium-info API error:', error.message);
    res.status(500).json({ message: '정보를 불러오지 못했습니다.' });
  }
}
