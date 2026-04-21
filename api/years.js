import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_KEY
);

/*
 * ──────────────────────────────────────────────────────────────────────────
 * ★ [수정] userStatus 기반으로 등급별 연도 목록 반환
 *
 *   FREE    → is_premium = false 문제의 연도만 (2003~2013)
 *   PREMIUM → is_premium = true AND is_verified = true 문제의 연도만 (2014~2019)
 *   ADMIN   → 전체 연도 (미검수 포함)
 *
 * Supabase SQL Editor에서 아래 뷰 2개를 미리 생성하면 성능이 향상됩니다:
 *
 *   -- FREE용 뷰
 *   CREATE OR REPLACE VIEW unique_years_free AS
 *   SELECT DISTINCT LEFT(CAST(exam_date AS TEXT), 4) AS year
 *   FROM questions
 *   WHERE exam_date IS NOT NULL
 *     AND LENGTH(CAST(exam_date AS TEXT)) >= 4
 *     AND is_premium = false
 *   ORDER BY year DESC;
 *
 *   -- PREMIUM용 뷰
 *   CREATE OR REPLACE VIEW unique_years_premium AS
 *   SELECT DISTINCT LEFT(CAST(exam_date AS TEXT), 4) AS year
 *   FROM questions
 *   WHERE exam_date IS NOT NULL
 *     AND LENGTH(CAST(exam_date AS TEXT)) >= 4
 *     AND is_premium = true
 *     AND is_verified = true
 *   ORDER BY year DESC;
 *
 *   -- ADMIN용 뷰 (기존 unique_years 그대로 사용)
 * ──────────────────────────────────────────────────────────────────────────
 */
export default async function handler(req, res) {
    // ★ [수정] POST로 userStatus 수신, GET 폴백도 지원
    const userStatus = req.body?.userStatus || req.query?.userStatus || 'free';

    try {
        let years = [];

        if (userStatus === 'free') {
            // ── FREE: is_premium = false 문제 연도만 ──────────────
            const { data: viewData, error: viewError } = await supabase
                .from('unique_years_free')
                .select('year');

            if (!viewError && viewData?.length > 0) {
                years = viewData.map(d => d.year);
            } else {
                // 뷰 없을 경우 폴백
                console.warn('[years.js] unique_years_free 뷰 없음 → 폴백');
                const { data, error } = await supabase
                    .from('questions')
                    .select('exam_date')
                    .eq('is_premium', false);
                if (error) throw error;
                years = [...new Set(data.map(d => String(d.exam_date).substring(0, 4)))];
            }

        } else if (userStatus === 'premium') {
            // ── PREMIUM: is_premium = true AND is_verified = true 연도만 ──
            const { data: viewData, error: viewError } = await supabase
                .from('unique_years_premium')
                .select('year');

            if (!viewError && viewData?.length > 0) {
                years = viewData.map(d => d.year);
            } else {
                // 뷰 없을 경우 폴백
                console.warn('[years.js] unique_years_premium 뷰 없음 → 폴백');
                const { data, error } = await supabase
                    .from('questions')
                    .select('exam_date')
                    .eq('is_premium', true)
                    .eq('is_verified', true);
                if (error) throw error;
                years = [...new Set(data.map(d => String(d.exam_date).substring(0, 4)))];
            }

        } else {
            // ── ADMIN: 전체 연도 (미검수 포함) ──────────────────────
            const { data: viewData, error: viewError } = await supabase
                .from('unique_years')
                .select('year');

            if (!viewError && viewData?.length > 0) {
                years = viewData.map(d => d.year);
            } else {
                console.warn('[years.js] unique_years 뷰 없음 → 폴백');
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
