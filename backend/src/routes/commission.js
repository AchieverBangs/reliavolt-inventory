const express = require('express');
const pool    = require('../db/pool');
const { verifyToken, requireRole } = require('../middleware/auth');
const { logActivity } = require('../services/activityLog');

const router = express.Router();
const SALE_ROLES = ['Admin', 'Manager', 'Cashier'];

// GET /api/commission/pending-mine — past (already-ended) months where the caller earned
// commission but hasn't confirmed receiving it yet.
router.get('/pending-mine', verifyToken, requireRole(...SALE_ROLES), async (req, res) => {
    try {
        const now = new Date();
        const { rows } = await pool.query(
            `SELECT sub.year, sub.month, sub.total
             FROM (
                SELECT EXTRACT(YEAR FROM sale_date)::int AS year,
                       EXTRACT(MONTH FROM sale_date)::int AS month,
                       SUM(commission) AS total
                FROM sales
                WHERE commission_user_id = $1
                  AND make_date(EXTRACT(YEAR FROM sale_date)::int, EXTRACT(MONTH FROM sale_date)::int, 1)
                        < make_date($2::int, $3::int, 1)
                GROUP BY 1, 2
                HAVING SUM(commission) > 0
             ) sub
             LEFT JOIN commission_settlements cs
                ON cs.user_id = $1 AND cs.year = sub.year AND cs.month = sub.month
             WHERE cs.staff_confirmed_at IS NULL
             ORDER BY sub.year, sub.month`,
            [req.user.id, now.getFullYear(), now.getMonth() + 1]
        );
        res.json(rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/commission/confirm-mine  { year, month } — the caller confirms they received
// their own commission for that month. Upserts a settlement row with a fresh snapshot total.
router.post('/confirm-mine', verifyToken, requireRole(...SALE_ROLES), async (req, res) => {
    const year  = parseInt(req.body.year, 10);
    const month = parseInt(req.body.month, 10);
    if (!year || !month || month < 1 || month > 12) {
        return res.status(400).json({ error: 'Valid year and month (1-12) are required' });
    }
    try {
        const { rows: totalRows } = await pool.query(
            `SELECT COALESCE(SUM(commission), 0) AS total FROM sales
             WHERE commission_user_id = $1
               AND EXTRACT(YEAR FROM sale_date) = $2 AND EXTRACT(MONTH FROM sale_date) = $3`,
            [req.user.id, year, month]
        );
        const total = totalRows[0].total;

        const { rows } = await pool.query(
            `INSERT INTO commission_settlements (user_id, year, month, total_commission, staff_confirmed_at)
             VALUES ($1, $2, $3, $4, NOW())
             ON CONFLICT (user_id, year, month)
             DO UPDATE SET staff_confirmed_at = NOW(), total_commission = EXCLUDED.total_commission
             RETURNING *`,
            [req.user.id, year, month, total]
        );
        logActivity(req, 'confirm', 'commission_settlement', rows[0].id,
            `Confirmed receipt of ${total} commission for ${year}-${String(month).padStart(2, '0')}`);
        res.json(rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/commission/pending-admin — Admin only. Past months, per staff member, where
// commission was earned but an Admin hasn't confirmed it was paid out yet.
router.get('/pending-admin', verifyToken, requireRole('Admin'), async (req, res) => {
    try {
        const now = new Date();
        const { rows } = await pool.query(
            `SELECT sub.user_id, u.name, u.username, u.role, sub.year, sub.month, sub.total
             FROM (
                SELECT commission_user_id AS user_id,
                       EXTRACT(YEAR FROM sale_date)::int AS year,
                       EXTRACT(MONTH FROM sale_date)::int AS month,
                       SUM(commission) AS total
                FROM sales
                WHERE commission_user_id IS NOT NULL
                  AND make_date(EXTRACT(YEAR FROM sale_date)::int, EXTRACT(MONTH FROM sale_date)::int, 1)
                        < make_date($1::int, $2::int, 1)
                GROUP BY 1, 2, 3
                HAVING SUM(commission) > 0
             ) sub
             JOIN users u ON u.id = sub.user_id
             LEFT JOIN commission_settlements cs
                ON cs.user_id = sub.user_id AND cs.year = sub.year AND cs.month = sub.month
             WHERE cs.admin_confirmed_at IS NULL
             ORDER BY sub.year, sub.month, u.name`,
            [now.getFullYear(), now.getMonth() + 1]
        );
        res.json(rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/commission/:userId/confirm-admin  { year, month } — Admin confirms a specific
// staff member's commission for that month has been paid out.
router.post('/:userId/confirm-admin', verifyToken, requireRole('Admin'), async (req, res) => {
    const userId = parseInt(req.params.userId, 10);
    const year   = parseInt(req.body.year, 10);
    const month  = parseInt(req.body.month, 10);
    if (!userId || !year || !month || month < 1 || month > 12) {
        return res.status(400).json({ error: 'Valid userId, year and month (1-12) are required' });
    }
    try {
        const { rows: totalRows } = await pool.query(
            `SELECT COALESCE(SUM(commission), 0) AS total FROM sales
             WHERE commission_user_id = $1
               AND EXTRACT(YEAR FROM sale_date) = $2 AND EXTRACT(MONTH FROM sale_date) = $3`,
            [userId, year, month]
        );
        const total = totalRows[0].total;

        const { rows } = await pool.query(
            `INSERT INTO commission_settlements (user_id, year, month, total_commission, admin_confirmed_at, admin_confirmed_by)
             VALUES ($1, $2, $3, $4, NOW(), $5)
             ON CONFLICT (user_id, year, month)
             DO UPDATE SET admin_confirmed_at = NOW(), admin_confirmed_by = $5, total_commission = EXCLUDED.total_commission
             RETURNING *`,
            [userId, year, month, total, req.user.id]
        );
        logActivity(req, 'confirm', 'commission_settlement', rows[0].id,
            `Confirmed payment of ${total} commission for user #${userId}, ${year}-${String(month).padStart(2, '0')}`);
        res.json(rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
