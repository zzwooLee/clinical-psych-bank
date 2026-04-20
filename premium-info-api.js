// 공개 정보는 코드에 직접 포함, 민감 정보는 환경변수에서 읽음
// premium-info.json 내용이 바뀌면 이 파일도 함께 수정

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method Not Allowed' });
  }

  // ── 공개 정보 (GitHub에 올려도 무방한 내용) ──
  const publicInfo = {
    title   : '프리미엄 멤버십',
    subtitle: '더 많은 문제와 심층 해설로\n합격을 앞당기세요.',
    price: {
      label : '이용 요금',
      amount: '월 9,900원'
    },
    bank: {
      label: '입금 계좌'
    },
    benefits: [
      '✅ 1급·2급 전체 기출문제 무제한 열람',
      '✅ AI 생성 예상 문제 제공',
      '✅ 연도·과목별 상세 필터링',
      '✅ 문제당 전문 해설 제공',
      '🚫 무료: 최대 20문제 / 일반 문제만'
    ],
    notice: '신청 이메일을 보내시면 관리자 확인 후 즉시 활성화됩니다.'
  };

  // ── 민감 정보 (Vercel 환경변수에서만 읽음) ──
  const merged = {
    ...publicInfo,
    bank: {
      label          : publicInfo.bank.label,
      bank_name      : process.env.BANK_NAME    || '',
      account_number : process.env.BANK_ACCOUNT || '',
      account_holder : process.env.BANK_HOLDER  || '',
    },
    admin_email: process.env.ADMIN_EMAIL || '',
  };

  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json(merged);
}
