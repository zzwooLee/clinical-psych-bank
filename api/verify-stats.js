// 관리자 전용 — 검수 완료/미완료 문제 수 조회

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).end();

    const { userStatus } = req.body;

    if (userStatus !== 'admin') {
        return res.status(403).json({ message: '권한이 없습니다.' });
    }

    try {
        // 프리미엄 문제(2014~2019년)만 검수 대상
        const { data, error } = await supabase
            .from('questions')
            .select('is_verified, explanation')
            .eq('is_premium', true);

        if (error) throw error;

        const total      = data.length;
        const verified   = data.filter(q => q.is_verified === true).length;
        const unverified = data.filter(q => q.is_verified === false).length;
        const hasExp     = data.filter(q => q.explanation).length;
        const noExp      = total - hasExp;

        res.status(200).json({
            total,
            verified,
            unverified,
            hasExplanation : hasExp,   // 해설 있음 (n8n 작성 완료)
            noExplanation  : noExp     // 해설 없음 (n8n 미처리)
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
}
