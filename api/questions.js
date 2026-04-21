import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ message: 'Method not allowed' });
    }

    const { grade, category, year, limit, userStatus } = req.body;

    try {
        let query = supabase.from('questions').select('*');

        if (userStatus === 'free') {
            // ── FREE 유저 ──────────────────────────────────────
            // · 2003~2013년 문제만 제공 (is_premium = false)
            // · is_verified 무관 — 해설이 없으므로 검수 불필요
            query = query.eq('is_premium', false);

        } else {
            // ── PREMIUM / ADMIN 유저 ───────────────────────────
            // · 전체 연도 문제 제공
            // · ★ [추가] is_verified = true 인 문제만 노출
            //   → n8n이 해설 생성 후 is_verified = false 로 저장
            //   → 관리자가 검수 완료 후 is_verified = true 로 변경
            //   → admin은 미검수 문제도 볼 수 있어야 관리 가능하므로 제외
            if (userStatus === 'premium') {
                query = query.eq('is_verified', true);
            }
            // admin은 is_verified 필터 없이 전체 조회 (관리 목적)
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
        let shuffled = data.sort(() => 0.5 - Math.random());

        // ★ free 유저는 서버에서 해설 필드 제거
        //   클라이언트 응답에서도 노출되지 않도록 서버단 처리
        if (userStatus === 'free') {
            shuffled = shuffled.map(({ explanation, is_verified, ...rest }) => rest);
        }

        res.status(200).json(shuffled);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
}
