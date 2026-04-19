/* api/questions.js */
/* 적용: #4 free 유저에게 is_premium 필터 추가 */

import { createClient } from '@supabase/supabase-js';

// 원본 키 유지 (Service Role Key는 Vercel 환경변수 준비 후 별도 교체)
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ message: 'Method not allowed' });
    }

    const { grade, category, year, limit, userStatus } = req.body;

    try {
        let query = supabase.from('questions').select('*');

        // [#4 핵심 수정] free 등급은 is_premium = false 문제만 조회
        // 원본에는 이 필터가 없어서 유료 문제가 그대로 노출되던 버그 수정
        if (userStatus === 'free') {
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
        const finalLimit = userStatus === 'free' ? 20 : (parseInt(limit) || 20);
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
