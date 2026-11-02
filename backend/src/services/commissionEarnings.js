// One row for the amount earned at sale time and one per repayment. Keep the
// salesperson from the sale, never the person who collected the payment.
// Reconstruct from allocation history so September/October 2026 are corrected too.
// Cumulative rounding makes the slices add up exactly to earned_commission.
const commissionEarnings = `(
    WITH payments AS (
        SELECT a.id, a.sale_id, a.amount, p.paid_at,
               SUM(a.amount) OVER (PARTITION BY a.sale_id ORDER BY p.paid_at, p.id, a.id) AS paid
        FROM credit_payment_allocations a
        JOIN credit_payments p ON p.id = a.payment_id
    ), slices AS (
        SELECT s.id, s.commission_user_id,
               CASE WHEN p.paid_at >= DATE '2026-09-01' THEN p.paid_at
                    ELSE s.commission_date END AS commission_date,
               ROUND(s.commission * LEAST(1, (s.total - s.credit_amount + p.paid) / NULLIF(s.total, 0)), 2)
               - ROUND(s.commission * LEAST(1, (s.total - s.credit_amount + p.paid - p.amount) / NULLIF(s.total, 0)), 2)
                 AS earned_commission
        FROM payments p JOIN sales s ON s.id = p.sale_id
    )
    SELECT s.id, s.commission_user_id, s.commission_date,
           s.earned_commission - COALESCE(a.earned_commission, 0) AS earned_commission
    FROM sales s
    LEFT JOIN (SELECT id, SUM(earned_commission) AS earned_commission FROM slices GROUP BY id) a ON a.id = s.id
    UNION ALL
    SELECT id, commission_user_id, commission_date, earned_commission FROM slices
)`;

module.exports = { commissionEarnings };
