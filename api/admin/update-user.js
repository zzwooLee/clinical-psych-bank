import { createClient } from '@supabase/supabase-js';

// [#6 수정] Service Role Key
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_KEY
);

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ message: 'Method Not Allowed' });
    }

    const { requesterId, targetUserId, newStatus, expiryDate } = req.body;

    // [#7 핵심 수정] 클라이언트 전달 userStatus 불신 → DB에서 직접 권한 조회
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

    try {
        // 업데이트 객체 구성 (undefined 필드 제외)
        const updateData = {};
        if (newStatus)   updateData.user_status  = newStatus;
        if (expiryDate)  updateData.expiry_date  = expiryDate;

        if (Object.keys(updateData).length === 0) {
            return res.status(400).json({ message: '변경할 데이터가 없습니다.' });
        }

        const { error } = await supabase
            .from('users')
            .update(updateData)
            .eq('id', targetUserId);

        if (error) throw error;
        return res.status(200).json({ message: '업데이트 완료' });
    } catch (error) {
        console.error('DB Error:', error.message);
        return res.status(500).json({ message: error.message });
    }
}
