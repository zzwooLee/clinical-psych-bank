import { createClient } from '@supabase/supabase-js';

// [#6 수정] Service Role Key
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_KEY
);

/*
 * ──────────────────────────────────────────────────────────────────────────
 * ★ [수정] userStatus 기반으로 등급별 연도 목록 반환
 *
 *   FREE    → unique_years_free 뷰 (is_premium = false, 2003~2013)
 *   PREMIUM → unique_years_premium 뷰 (is_premium = true AND is_verified = true, 2014~2021)
 *   ADMIN   → unique_years 뷰 (전체 연도, 미검수 포함)
 *
 * [뷰 우선 사용, 직접 쿼리 폴백]
 * 뷰 조회 실패 시 questions 테이블 직접 쿼리로 폴백합니다.
 *
 * Supabase에 생성된 뷰 3개:
 *   - unique_years       : 전체 연도 (ADMIN용)
 *   - unique_years_free  : is_premium = false 연도 (FREE용)
 *   - unique_years_premium : is_premium = true AND is_verified = true (PREMIUM용)
 * ──────────────────────────────────────────────────────────────────────────
 */
export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ message: 'Method Not Allowed' });
    }

    // 캐시 방지 헤더
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Pragma', 'no-cache');

    // userStatus 파싱 — body가 없으면 'free' 기본값
    const userStatus = req.body?.userStatus || 'free';

    try {
        let years = [];

        if (userStatus === 'free') {
            // ── FREE: unique_years_free 뷰 우선 시도 ──────────────
            const { data: viewData, error: viewError } = await supabase
                .from('unique_years_free')
                .select('year');

            if (!viewError && viewData?.length > 0) {
                years = viewData.map(d => d.year);
            } else {
                // 뷰 없을 경우 직접 쿼리 폴백
                console.warn('[years.js] unique_years_free 뷰 조회 실패 → 직접 쿼리 폴백');
                const { data, error } = await supabase
                    .from('questions')
                    .select('exam_date')
                    .eq('is_premium', false);
                if (error) throw error;
                years = [...new Set(data.map(d => String(d.exam_date).substring(0, 4)))];
            }

        } else if (userStatus === 'premium') {
            // ── PREMIUM: unique_years_premium 뷰 우선 시도 ────────
            const { data: viewData, error: viewError } = await supabase
                .from('unique_years_premium')
                .select('year');

            if (!viewError && viewData?.length > 0) {
                years = viewData.map(d => d.year);
            } else {
                // 뷰 없을 경우 직접 쿼리 폴백
                console.warn('[years.js] unique_years_premium 뷰 조회 실패 → 직접 쿼리 폴백');
                const { data, error } = await supabase
                    .from('questions')
                    .select('exam_date')
                    .eq('is_premium', true)
                    .eq('is_verified', true);
                if (error) throw error;
                years = [...new Set(data.map(d => String(d.exam_date).substring(0, 4)))];
            }

        } else {
            // ── ADMIN: unique_years 뷰 우선 시도 (전체, 미검수 포함) ──
            const { data: viewData, error: viewError } = await supabase
                .from('unique_years')
                .select('year');

            if (!viewError && viewData?.length > 0) {
                years = viewData.map(d => d.year);
            } else {
                // 뷰 없을 경우 직접 쿼리 폴백
                console.warn('[years.js] unique_years 뷰 조회 실패 → 직접 쿼리 폴백');
                const { data, error } = await supabase
                    .from('questions')
                    .select('exam_date');
                if (error) throw error;
                years = [...new Set(data.map(d => String(d.exam_date).substring(0, 4)))];
            }
        }

        // 공통 정제 및 내림차순 정렬
        const result = years
            .filter(y => y && y.length === 4)
            .sort((a, b) => b - a);

        res.status(200).json(result);

    } catch (error) {
        res.status(500).json({ message: error.message });
    }
}
