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

    const { requesterId, targetUserId } = req.body;

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

    // 자기 자신을 삭제하는 사고 방지
    if (requesterId === targetUserId) {
        return res.status(400).json({ message: '자기 자신은 삭제할 수 없습니다.' });
    }

    try {
        const { error } = await supabase
            .from('users')
            .delete()
            .eq('id', targetUserId);

        if (error) throw error;
        res.status(200).json({ message: '삭제 완료' });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
}
