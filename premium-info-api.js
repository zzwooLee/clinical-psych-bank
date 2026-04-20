// 공개 정보(premium-info.js) + 민감 정보(환경변수) 병합 후 반환

import PREMIUM_INFO from './premium-info.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method Not Allowed' });
  }

  // 공개 정보 + 민감 정보(환경변수) 병합
  const merged = {
    ...PREMIUM_INFO,
    bank: {
      label          : PREMIUM_INFO.bank?.label || '입금 계좌',
      bank_name      : process.env.BANK_NAME    || '',
      account_number : process.env.BANK_ACCOUNT || '',
      account_holder : process.env.BANK_HOLDER  || '',
    },
    admin_email: process.env.ADMIN_EMAIL || '',
  };

  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json(merged);
}
