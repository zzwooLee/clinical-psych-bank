import { createClient } from '@supabase/supabase-js';

// [#6 수정] Service Role Key
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_KEY
);

/*
 * ──────────────────────────────────────────────────────────────────────────
 * [#9 선행 작업] Supabase SQL Editor에서 아래 뷰를 먼저 생성해주세요:
 *
 *   CREATE OR REPLACE VIEW unique_years AS
 *   SELECT DISTINCT
 *       LEFT(CAST(exam_date AS TEXT), 4) AS year
 *   FROM questions
 *   WHERE exam_date IS NOT NULL
 *     AND LENGTH(CAST(exam_date AS TEXT)) >= 4
 *   ORDER BY year DESC;
 *
 * 뷰 생성 후 이 API가 자동으로 최적화된 방식으로 동작합니다.
 * 뷰가 없을 경우 아래 코드는 폴백(fallback)으로 전체 데이터를 로드합니다.
 * ──────────────────────────────────────────────────────────────────────────
 */
export default async function handler(req, res) {
    try {
        // [#9 최적화] unique_years 뷰 우선 시도
        const { data: viewData, error: viewError } = await supabase
            .from('unique_years')
            .select('year');

        if (!viewError && viewData && viewData.length > 0) {
            // 뷰에서 정상 조회된 경우
            const years = viewData
                .map(d => d.year)
                .filter(y => y && y.length === 4)
                .sort((a, b) => b - a);
            return res.status(200).json(years);
        }

        // [폴백] 뷰가 없을 경우 기존 방식으로 처리
        console.warn('[years.js] unique_years 뷰 없음 → 폴백 실행. Supabase에서 뷰를 생성하면 성능이 향상됩니다.');
        const { data, error } = await supabase
            .from('questions')
            .select('exam_date');

        if (error) throw error;

        const uniqueYears = [...new Set(data.map(item => {
            const dateStr = String(item.exam_date);
            return dateStr.substring(0, 4);
        }))]
        .filter(year => year && year.length === 4)
        .sort((a, b) => b - a);

        res.status(200).json(uniqueYears);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
}
