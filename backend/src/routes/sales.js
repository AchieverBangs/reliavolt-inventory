const express = require('express');
const pool    = require('../db/pool');
const { verifyToken, requireRole } = require('../middleware/auth');
const { logActivity } = require('../services/activityLog');

const router = express.Router();
const SALE_ROLES = ['Admin', 'Manager', 'Cashier'];

// unit_cost/profit reveal margin on top of cost — Admin-only, same rule as products.cost_price
function hideCost(rowOrRows, role) {
    if (role === 'Admin') return rowOrRows;
    const strip = (r) => { const { unit_cost, profit, ...rest } = r; return rest; };
    return Array.isArray(rowOrRows) ? rowOrRows.map(strip) : strip(rowOrRows);
}

// Parses a YYYY-MM-DD sale_date, rejects future dates, and keeps a given time-of-day
// (defaults to now) so same-day entries still sort sensibly against each other.
// Throws on invalid input — callers decide how to turn that into an HTTP response.
function parseSaleDate(sale_date, keepTimeFrom = new Date()) {
    const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(sale_date);
    if (!parts) throw new Error('sale_date must be in YYYY-MM-DD format');
    const [, y, m, d] = parts.map(Number);
    const chosenDateOnly = new Date(y, m - 1, d);
    if (isNaN(chosenDateOnly.getTime())) throw new Error('Invalid sale_date');

    const now = new Date();
    const todayOnly = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (chosenDateOnly > todayOnly) throw new Error('Sale date cannot be in the future');

    return new Date(y, m - 1, d, keepTimeFrom.getHours(), keepTimeFrom.getMinutes(), keepTimeFrom.getSeconds());
}

// GET /api/sales  (optional ?from=&to=&product_id=&payment_method= filters; non-Admins scoped to their own shop)
router.get('/', verifyToken, async (req, res) => {
    try {
        let query  = 'SELECT * FROM sales';
        const vals = [];
        const conditions = [];

        if (req.query.from)           { vals.push(req.query.from);           conditions.push(`sale_date >= $${vals.length}`); }
        if (req.query.to)             { vals.push(req.query.to);             conditions.push(`sale_date <= $${vals.length}`); }
        if (req.query.product_id)     { vals.push(req.query.product_id);     conditions.push(`product_id = $${vals.length}`); }
        if (req.query.payment_method) { vals.push(req.query.payment_method); conditions.push(`payment_method = $${vals.length}`); }

        if (req.user.role === 'Admin') {
            if (req.query.shop_id) { vals.push(req.query.shop_id); conditions.push(`shop_id = $${vals.length}`); }
        } else {
            if (!req.user.shopId) return res.json([]);
            vals.push(req.user.shopId);
            conditions.push(`shop_id = $${vals.length}`);
        }

        if (conditions.length) query += ' WHERE ' + conditions.join(' AND ');
        query += ' ORDER BY sale_date DESC';

        const { rows } = await pool.query(query, vals);
        res.json(hideCost(rows, req.user.role));
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/sales/commission/summary — the caller's own commission by day/week/month/year;
// Admins also get a by-staff breakdown across everyone who can sell.
// Optional ?year=&month= (month 1-12) filters an additional "selected" total for any
// specific month/year (or the whole year, if month is omitted) on top of the fixed buckets.
router.get('/commission/summary', verifyToken, requireRole(...SALE_ROLES), async (req, res) => {
    try {
        const { rows: mine } = await pool.query(
            `SELECT
                COALESCE(SUM(commission) FILTER (WHERE sale_date >= CURRENT_DATE), 0) AS today,
                COALESCE(SUM(commission) FILTER (WHERE sale_date >= date_trunc('week',  CURRENT_DATE)), 0) AS week,
                COALESCE(SUM(commission) FILTER (WHERE sale_date >= date_trunc('month', CURRENT_DATE)), 0) AS month,
                COALESCE(SUM(commission) FILTER (WHERE sale_date >= date_trunc('year',  CURRENT_DATE)), 0) AS year
             FROM sales WHERE commission_user_id = $1`,
            [req.user.id]
        );

        const result = { mine: mine[0] };

        const year  = parseInt(req.query.year, 10);
        const monthRaw = parseInt(req.query.month, 10);
        const month = (monthRaw >= 1 && monthRaw <= 12) ? monthRaw : null;

        if (year) {
            const { rows: selected } = await pool.query(
                `SELECT COALESCE(SUM(commission) FILTER (
                    WHERE EXTRACT(YEAR FROM sale_date) = $2
                      AND ($3::int IS NULL OR EXTRACT(MONTH FROM sale_date) = $3)
                 ), 0) AS selected
                 FROM sales WHERE commission_user_id = $1`,
                [req.user.id, year, month]
            );
            result.mine.selected = selected[0].selected;
            result.selectedPeriod = { year, month };

            // Settlement (confirm-received/confirm-paid) status is a per-month concept,
            // so it's only meaningful once a specific month (not a whole year) is selected.
            if (month) {
                const { rows: settlement } = await pool.query(
                    `SELECT staff_confirmed_at, admin_confirmed_at FROM commission_settlements
                     WHERE user_id = $1 AND year = $2 AND month = $3`,
                    [req.user.id, year, month]
                );
                result.mine.settlement = settlement[0] || { staff_confirmed_at: null, admin_confirmed_at: null };
            }
        }

        if (req.user.role === 'Admin') {
            const { rows: byStaff } = await pool.query(
                `SELECT u.id AS user_id, u.name, u.username, u.role,
                    COALESCE(SUM(s.commission) FILTER (WHERE s.sale_date >= CURRENT_DATE), 0) AS today,
                    COALESCE(SUM(s.commission) FILTER (WHERE s.sale_date >= date_trunc('week',  CURRENT_DATE)), 0) AS week,
                    COALESCE(SUM(s.commission) FILTER (WHERE s.sale_date >= date_trunc('month', CURRENT_DATE)), 0) AS month,
                    COALESCE(SUM(s.commission) FILTER (WHERE s.sale_date >= date_trunc('year',  CURRENT_DATE)), 0) AS year,
                    COALESCE(SUM(s.commission) FILTER (
                        WHERE $2::int IS NOT NULL AND EXTRACT(YEAR FROM s.sale_date) = $2
                          AND ($3::int IS NULL OR EXTRACT(MONTH FROM s.sale_date) = $3)
                    ), 0) AS selected,
                    cs.staff_confirmed_at, cs.admin_confirmed_at
                 FROM users u
                 LEFT JOIN sales s ON s.commission_user_id = u.id
                 LEFT JOIN commission_settlements cs
                    ON cs.user_id = u.id AND cs.year = $2::int AND cs.month = $3::int
                 WHERE u.role = ANY($1)
                 GROUP BY u.id, u.name, u.username, u.role, cs.staff_confirmed_at, cs.admin_confirmed_at
                 ORDER BY u.name`,
                [SALE_ROLES, year || null, month]
            );
            result.byStaff = byStaff;
        }

        res.json(result);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/sales/:id
router.get('/:id', verifyToken, async (req, res) => {
    try {
        const { rows } = await pool.query('SELECT * FROM sales WHERE id = $1', [req.params.id]);
        const sale = rows[0];
        if (!sale) return res.status(404).json({ error: 'Sale not found' });
        if (req.user.role !== 'Admin' && sale.shop_id !== req.user.shopId) {
            return res.status(404).json({ error: 'Sale not found' });
        }
        res.json(hideCost(sale, req.user.role));
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/sales  — records a sale, decrements stock, and auto-creates the customer record
// (customers are never added by hand — a name only enters the system via a sale)
router.post('/', verifyToken, requireRole(...SALE_ROLES), async (req, res) => {
    const { product_id, customer_id, customer_name, customer_phone, qty, payment_method, sale_date } = req.body;
    if (!product_id || !qty) return res.status(400).json({ error: 'product_id and qty are required' });

    // Optional backdating — lets a late entry reflect when the sale actually happened
    // instead of when it was typed in.
    let saleDate = new Date();
    if (sale_date) {
        try {
            saleDate = parseSaleDate(sale_date);
        } catch (err) {
            return res.status(400).json({ error: err.message });
        }
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const { rows: pRows } = await client.query('SELECT * FROM products WHERE id = $1 FOR UPDATE', [product_id]);
        const product = pRows[0];
        if (!product) throw new Error('Product not found');
        if (req.user.role !== 'Admin' && product.shop_id !== req.user.shopId) {
            throw new Error('You can only sell products from your own shop');
        }
        if (product.quantity < qty) throw new Error(`Insufficient stock (${product.quantity} available)`);

        // Decrement stock
        await client.query('UPDATE products SET quantity = quantity - $1 WHERE id = $2', [qty, product_id]);

        // Build receipt number
        const { rows: cntRows } = await client.query('SELECT COUNT(*) FROM sales');
        const receiptNo = `RV-${2000 + parseInt(cntRows[0].count) + 1}`;

        const unitPrice  = parseFloat(product.selling_price);
        const unitCost   = parseFloat(product.cost_price);
        const total      = unitPrice * qty;
        const profit     = (unitPrice - unitCost) * qty;
        const commission = parseFloat(product.commission || 0) * qty;
        // A product with a designated commission owner always credits them; otherwise it
        // goes to whoever actually rang up this sale.
        const commissionUserId = product.commission_user_id || req.user.id;

        // Resolve/auto-create the customer — this is the only place a customer record is ever created
        let resolvedCustomerId = null;
        let cName = 'Walk-in Customer';

        if (customer_id) {
            const { rows: cuRows } = await client.query('SELECT id, name, shop_id FROM customers WHERE id=$1', [customer_id]);
            if (!cuRows[0]) throw new Error('Customer not found');
            if (req.user.role !== 'Admin' && cuRows[0].shop_id !== req.user.shopId) {
                throw new Error('You can only sell to customers from your own shop');
            }
            resolvedCustomerId = cuRows[0].id;
            cName = cuRows[0].name;
        } else if (customer_name && customer_name.trim() && customer_name.trim().toLowerCase() !== 'walk-in customer') {
            const name = customer_name.trim();
            const { rows: existing } = await client.query(
                'SELECT id, name FROM customers WHERE LOWER(name) = LOWER($1) AND shop_id = $2',
                [name, product.shop_id]
            );
            if (existing[0]) {
                resolvedCustomerId = existing[0].id;
                cName = existing[0].name;
            } else {
                const { rows: created } = await client.query(
                    'INSERT INTO customers (name, phone, shop_id) VALUES ($1, $2, $3) RETURNING id, name',
                    [name, customer_phone || null, product.shop_id]
                );
                resolvedCustomerId = created[0].id;
                cName = created[0].name;
            }
        }

        const { rows } = await client.query(
            `INSERT INTO sales
             (receipt_no, product_id, product_name, customer_id, customer_name, qty,
              unit_price, unit_cost, total, profit, commission, payment_method, shop_id, user_id, commission_user_id, sale_date)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
            [receiptNo, product_id, product.name, resolvedCustomerId, cName,
             qty, unitPrice, unitCost, total, profit, commission, payment_method || 'Cash', product.shop_id, req.user.id, commissionUserId, saleDate]
        );

        await client.query(
            `INSERT INTO stock_movements (product_id, type, qty_change, balance_after, note, user_id, sale_id)
             VALUES ($1, 'sale', $2, $3, $4, $5, $6)`,
            [product_id, -qty, product.quantity - qty, `Sold via receipt ${receiptNo}`, req.user.id, rows[0].id]
        );

        await client.query('COMMIT');
        logActivity(req, 'create', 'sale', rows[0].id, `Sold ${qty} x "${product.name}" — receipt ${receiptNo}`);
        res.status(201).json(hideCost(rows[0], req.user.role));
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(400).json({ error: err.message });
    } finally {
        client.release();
    }
});

// PUT /api/sales/:id  — edit an already-recorded sale, scoped to the caller's own
// shop for non-Admins. Only date, payment method, and customer name can change —
// product/quantity/prices stay locked (changing those would mean reversing and
// reapplying stock and profit, a much bigger operation); delete and re-record
// instead if one of those was wrong.
router.put('/:id', verifyToken, requireRole(...SALE_ROLES), async (req, res) => {
    const { sale_date, payment_method, customer_name, customer_phone } = req.body;

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const { rows: existing } = await client.query('SELECT * FROM sales WHERE id = $1 FOR UPDATE', [req.params.id]);
        const sale = existing[0];
        if (!sale) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Sale not found' }); }
        if (req.user.role !== 'Admin' && sale.shop_id !== req.user.shopId) {
            await client.query('ROLLBACK');
            return res.status(403).json({ error: 'You can only edit sales from your own shop' });
        }

        let newSaleDate = sale.sale_date;
        if (sale_date !== undefined) {
            try {
                newSaleDate = parseSaleDate(sale_date, new Date(sale.sale_date));
            } catch (err) {
                await client.query('ROLLBACK');
                return res.status(400).json({ error: err.message });
            }
        }

        // Re-resolve the customer the same way a fresh sale does, only if the name actually changed
        let resolvedCustomerId = sale.customer_id;
        let cName = sale.customer_name;
        if (customer_name !== undefined && customer_name.trim() && customer_name.trim() !== sale.customer_name) {
            const name = customer_name.trim();
            if (name.toLowerCase() === 'walk-in customer') {
                resolvedCustomerId = null;
                cName = 'Walk-in Customer';
            } else {
                const { rows: existingCust } = await client.query(
                    'SELECT id, name FROM customers WHERE LOWER(name) = LOWER($1) AND shop_id = $2',
                    [name, sale.shop_id]
                );
                if (existingCust[0]) {
                    resolvedCustomerId = existingCust[0].id;
                    cName = existingCust[0].name;
                } else {
                    const { rows: created } = await client.query(
                        'INSERT INTO customers (name, phone, shop_id) VALUES ($1, $2, $3) RETURNING id, name',
                        [name, customer_phone || null, sale.shop_id]
                    );
                    resolvedCustomerId = created[0].id;
                    cName = created[0].name;
                }
            }
        }

        const newPaymentMethod = payment_method !== undefined ? payment_method : sale.payment_method;

        const { rows: updated } = await client.query(
            `UPDATE sales SET sale_date=$1, payment_method=$2, customer_id=$3, customer_name=$4 WHERE id=$5 RETURNING *`,
            [newSaleDate, newPaymentMethod, resolvedCustomerId, cName, req.params.id]
        );

        await client.query('COMMIT');
        logActivity(req, 'update', 'sale', updated[0].id, `Edited sale — receipt ${updated[0].receipt_no}`);
        res.json(hideCost(updated[0], req.user.role));
    } catch (err) {
        await client.query('ROLLBACK');
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    } finally {
        client.release();
    }
});

// DELETE /api/sales/:id  (Admin only)
router.delete('/:id', verifyToken, requireRole('Admin'), async (req, res) => {
    try {
        const { rows: existing } = await pool.query('SELECT receipt_no FROM sales WHERE id = $1', [req.params.id]);
        const { rowCount } = await pool.query('DELETE FROM sales WHERE id = $1', [req.params.id]);
        if (!rowCount) return res.status(404).json({ error: 'Sale not found' });
        logActivity(req, 'delete', 'sale', req.params.id, `Deleted sale — receipt ${existing[0]?.receipt_no || req.params.id}`);
        res.json({ message: 'Sale deleted' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
