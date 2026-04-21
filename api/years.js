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
 *   FREE    → is_premium = false 문제의 연도만 (2003~2013)
 *   PREMIUM → is_premium = true AND is_verified = true 문제의 연도만 (2014~2019)
 *   ADMIN   → 전체 연도 (미검수 포함)
 *
 * [뷰 방식에서 직접 쿼리 방식으로 변경한 이유]
 * 기존에는 unique_years_free / unique_years_premium 뷰를 사용했으나,
 * 뷰 조회 실패(미생성 또는 권한 오류) 시 폴백이 전체 연도를 반환하는
 * 문제가 발생하여 직접 쿼리 방식으로 교체합니다.
 * 트래픽이 많아지면 아래 뷰를 생성해 다시 활용할 수 있습니다:
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
 *   CREATE OR REPLACE VIEW unique_years AS
 *   SELECT DISTINCT LEFT(CAST(exam_date AS TEXT), 4) AS year
 *   FROM questions
 *   WHERE exam_date IS NOT NULL
 *     AND LENGTH(CAST(exam_date AS TEXT)) >= 4
 *   ORDER BY year DESC;
 * ──────────────────────────────────────────────────────────────────────────
 */
export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ message: 'Method Not Allowed' });
    }

    // userStatus 파싱 — body가 없으면 'free' 기본값
    const userStatus = req.body?.userStatus || 'free';

    try {
        let query = supabase
            .from('questions')
            .select('exam_date');

        if (userStatus === 'free') {
            // FREE: is_premium = false 문제 연도만 (2003~2013)
            query = query.eq('is_premium', false);

        } else if (userStatus === 'premium') {
            // PREMIUM: 검수 완료된 프리미엄 문제 연도만 (2014~2019)
            query = query
                .eq('is_premium', true)
                .eq('is_verified', true);

        }
        // ADMIN: 필터 없이 전체 연도 (미검수 포함)

        const { data, error } = await query;
        if (error) throw error;

        // 중복 제거 → 연도 4자리 추출 → 내림차순 정렬
        const years = [...new Set(
            data
                .map(d => String(d.exam_date).substring(0, 4))
                .filter(y => y && y.length === 4)
        )].sort((a, b) => b - a);

        res.status(200).json(years);

    } catch (error) {
        res.status(500).json({ message: error.message });
    }
}
