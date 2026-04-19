import { createClient } from '@supabase/supabase-js';

// [#2 핵심 수정] 파일 내 supabase 클라이언트 선언 누락 → 추가
// [#6 수정] anon key → Service Role Key
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_KEY
);

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ message: 'Method Not Allowed' });
    }

    const { targetUserId, months, requesterId } = req.body;

    // [#7 수정] 클라이언트 전달 userStatus 불신 → DB에서 직접 권한 조회
    if (!requesterId) {
        return res.status(403).json({ message: '요청자 ID가 없습니다.' });
    }

    const { data: requester, error: authErr } = await supabase
        .from('users')
        .select('user_status')
        .eq('id', requesterId)
        .single();

    if (authErr || !requester || requester.user_status !== 'admin') {
        return res.status(403).json({ message: '권한이 없습니다.' });
    }

    // 오늘부터 입력된 개월 수 뒤 날짜 계산
    const expiry = new Date();
    expiry.setMonth(expiry.getMonth() + parseInt(months || 1));

    try {
        const { error } = await supabase
            .from('users')
            .update({
                user_status : 'premium',
                expiry_date : expiry.toISOString()
            })
            .eq('id', targetUserId);

        if (error) throw error;
        res.status(200).json({ message: '구독 갱신 완료' });
    } catch (e) {
        res.status(500).json({ message: e.message });
    }
}
