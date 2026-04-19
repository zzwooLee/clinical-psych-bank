import { createClient } from '@supabase/supabase-js';

// [#6 수정] anon key → Service Role Key
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ message: 'Method not allowed' });
    }

    const { grade, category, year, limit, userId } = req.body;

    // ─── [#7 수정] 클라이언트 전달 userStatus 불신 → DB에서 직접 조회 ───
    let actualStatus = 'free';
    if (userId) {
        const { data: requester, error: authErr } = await supabase
            .from('users')
            .select('user_status, expiry_date')
            .eq('id', userId)
            .single();

        if (!authErr && requester) {
            // 만료일 재검증 (login.js 외에 이중 방어)
            if (requester.user_status === 'premium' && requester.expiry_date) {
                const expired = new Date(requester.expiry_date) < new Date();
                actualStatus = expired ? 'free' : 'premium';
            } else {
                actualStatus = requester.user_status || 'free';
            }
        }
    }

    try {
        let query = supabase.from('questions').select('*');

        // [#4 핵심 수정] free 등급은 is_premium = false 문제만 조회
        if (actualStatus === 'free') {
            query = query.eq('is_premium', false);
        }

        if (grade)    query = query.eq('grade', grade);
        if (category) query = query.eq('category', category);

        // exam_date 기반 연도 필터 (YYYYMMDD 숫자형)
        if (year && year.length === 4) {
            const start = parseInt(year + '0000');
            const end   = parseInt(year + '9999');
            query = query.gte('exam_date', start).lte('exam_date', end);
        }

        // 등급별 개수 제한
        const finalLimit = actualStatus === 'free' ? 20 : (parseInt(limit) || 20);
        query = query.limit(finalLimit);

        const { data, error } = await query;
        if (error) throw error;

        // 랜덤 셔플
        const shuffled = data.sort(() => 0.5 - Math.random());
        res.status(200).json(shuffled);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
}
