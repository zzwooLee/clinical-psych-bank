// api/admin/update-expiry.js
export default async function handler(req, res) {
  const { targetUserId, months, userStatus } = req.body;
  if (userStatus !== 'admin') return res.status(403).send("Forbidden");

  // 오늘부터 1개월(혹은 입력된 개월 수) 뒤 날짜 계산
  const expiry = new Date();
  expiry.setMonth(expiry.getMonth() + parseInt(months));

  try {
    const { error } = await supabase
      .from('users')
      .update({ 
          user_status: 'premium',
          expiry_date: expiry.toISOString() 
      })
      .eq('id', targetUserId);

    if (error) throw error;
    res.status(200).json({ message: "구독 갱신 완료" });
  } catch (e) { res.status(500).send(e.message); }
}
