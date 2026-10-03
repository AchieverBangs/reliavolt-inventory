const express = require('express');
const pool    = require('../db/pool');
const { verifyToken, requireRole } = require('../middleware/auth');
const { logActivity } = require('../services/activityLog');

const router = express.Router();

// Same shape as sales.js's own date backdating — a payment can be logged for the day it
// actually happened, not just the day it was typed in.
function parsePaidDate(dateStr) {
    const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
    if (!parts) throw new Error('paid_date must be in YYYY-MM-DD format');
    const [, y, m, d] = parts.map(Number);
    const chosen = new Date(y, m - 1, d);
    if (isNaN(chosen.getTime())) throw new Error('Invalid paid_date');
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (chosen > today) throw new Error('Payment date cannot be in the future');
    return new Date(y, m - 1, d, now.getHours(), now.getMinutes(), now.getSeconds());
}

// GET /api/customers  (scoped to the caller's shop unless Admin; Admin may pass ?shop_id=)
router.get('/', verifyToken, async (req, res) => {
    try {
        let query = 'SELECT * FROM customers';
        const vals = [];

        if (req.user.role === 'Admin') {
            if (req.query.shop_id) {
                vals.push(req.query.shop_id);
                query += ` WHERE shop_id = $${vals.length}`;
            }
        } else {
            if (!req.user.shopId) return res.json([]);
            vals.push(req.user.shopId);
            query += ` WHERE shop_id = $${vals.length}`;
        }

        query += ' ORDER BY name';
        const { rows } = await pool.query(query, vals);
        res.json(rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/customers/credit — customers currently owing money (shop-scoped unless Admin)
router.get('/credit', verifyToken, async (req, res) => {
    try {
        let query = `SELECT c.*, s.name AS shop_name FROM customers c
                      LEFT JOIN shops s ON s.id = c.shop_id
                      WHERE c.credit_balance > 0`;
        const vals = [];

        if (req.user.role === 'Admin') {
            if (req.query.shop_id) { vals.push(req.query.shop_id); query += ` AND c.shop_id = $${vals.length}`; }
        } else {
            if (!req.user.shopId) return res.json([]);
            vals.push(req.user.shopId);
            query += ` AND c.shop_id = $${vals.length}`;
        }

        query += ' ORDER BY c.credit_balance DESC';
        const { rows } = await pool.query(query, vals);
        res.json(rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/customers/:id
router.get('/:id', verifyToken, async (req, res) => {
    try {
        const { rows } = await pool.query('SELECT * FROM customers WHERE id = $1', [req.params.id]);
        const customer = rows[0];
        if (!customer) return res.status(404).json({ error: 'Customer not found' });
        if (req.user.role !== 'Admin' && customer.shop_id !== req.user.shopId) {
            return res.status(404).json({ error: 'Customer not found' });
        }
        res.json(customer);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/customers/:id/credit-history — every credit sale and every payment, oldest
// first, so the running balance's story is visible end to end.
router.get('/:id/credit-history', verifyToken, async (req, res) => {
    try {
        const { rows: cRows } = await pool.query('SELECT id, name, shop_id, credit_balance FROM customers WHERE id = $1', [req.params.id]);
        const customer = cRows[0];
        if (!customer) return res.status(404).json({ error: 'Customer not found' });
        if (req.user.role !== 'Admin' && customer.shop_id !== req.user.shopId) {
            return res.status(404).json({ error: 'Customer not found' });
        }

        const { rows: sales } = await pool.query(
            `SELECT 'sale' AS type, id, receipt_no, product_name, qty, credit_amount AS amount, sale_date AS at
             FROM sales WHERE customer_id = $1 AND credit_amount > 0`,
            [req.params.id]
        );
        const { rows: payments } = await pool.query(
            `SELECT 'payment' AS type, cp.id, cp.amount, cp.note, cp.paid_at AS at, u.name AS recorded_by
             FROM credit_payments cp LEFT JOIN users u ON u.id = cp.user_id
             WHERE cp.customer_id = $1`,
            [req.params.id]
        );

        const timeline = [...sales, ...payments].sort((a, b) => new Date(a.at) - new Date(b.at));
        res.json({ customer: { id: customer.id, name: customer.name, credit_balance: customer.credit_balance }, timeline });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/customers/:id/credit-payments  { amount, note?, paid_date? }
router.post('/:id/credit-payments', verifyToken, requireRole('Admin', 'Manager', 'Cashier'), async (req, res) => {
    const { amount, note, paid_date } = req.body;
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) return res.status(400).json({ error: 'A positive payment amount is required' });

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const { rows: cRows } = await client.query('SELECT id, name, shop_id, credit_balance FROM customers WHERE id = $1 FOR UPDATE', [req.params.id]);
        const customer = cRows[0];
        if (!customer) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Customer not found' }); }
        if (req.user.role !== 'Admin' && customer.shop_id !== req.user.shopId) {
            await client.query('ROLLBACK');
            return res.status(403).json({ error: 'You can only record payments for customers from your own shop' });
        }
        if (amt > parseFloat(customer.credit_balance)) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: `Payment exceeds balance owed (Le ${customer.credit_balance})` });
        }

        let paidAt = new Date();
        if (paid_date) {
            try {
                paidAt = parsePaidDate(paid_date);
            } catch (err) {
                await client.query('ROLLBACK');
                return res.status(400).json({ error: err.message });
            }
        }

        const newBalance = parseFloat(customer.credit_balance) - amt;
        await client.query('UPDATE customers SET credit_balance = $1 WHERE id = $2', [newBalance, customer.id]);

        // Allocate this payment across the customer's still-open credit sales, oldest
        // first — each sale's earned_commission (a generated column) recomputes
        // automatically as its credit_amount_paid goes up, so the salesperson's
        // commission on that sale builds up as it actually gets paid off, not upfront.
        const { rows: openSales } = await client.query(
            `SELECT id, credit_amount, credit_amount_paid FROM sales
             WHERE customer_id = $1 AND credit_amount > credit_amount_paid
             ORDER BY sale_date ASC, id ASC
             FOR UPDATE`,
            [customer.id]
        );
        let remaining = amt;
        for (const sale of openSales) {
            if (remaining <= 0) break;
            const owed = parseFloat(sale.credit_amount) - parseFloat(sale.credit_amount_paid);
            const apply = Math.min(remaining, owed);
            if (apply > 0) {
                await client.query('UPDATE sales SET credit_amount_paid = credit_amount_paid + $1 WHERE id = $2', [apply, sale.id]);
                remaining -= apply;
            }
        }

        const { rows: payment } = await client.query(
            `INSERT INTO credit_payments (customer_id, amount, note, shop_id, user_id, paid_at)
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
            [customer.id, amt, note || null, customer.shop_id, req.user.id, paidAt]
        );

        await client.query('COMMIT');
        logActivity(req, 'create', 'credit_payment', payment[0].id, `Recorded Le ${amt} credit payment from "${customer.name}"`);
        res.status(201).json({ payment: payment[0], newBalance });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    } finally {
        client.release();
    }
});

// Note: there is no POST / here on purpose — a customer record is only ever created
// automatically as a side effect of recording a sale (see sales.js). Editing/deleting
// an existing record (e.g. to fix a typo) is still allowed below.

// PUT /api/customers/:id
router.put('/:id', verifyToken, requireRole('Admin', 'Manager', 'Cashier'), async (req, res) => {
    const { name, phone, address } = req.body;
    if (!name) return res.status(400).json({ error: 'Customer name is required' });

    try {
        const { rows: existingRows } = await pool.query('SELECT shop_id FROM customers WHERE id = $1', [req.params.id]);
        if (!existingRows[0]) return res.status(404).json({ error: 'Customer not found' });

        let shop_id = existingRows[0].shop_id;
        if (req.user.role === 'Admin') {
            if (req.body.shop_id) shop_id = req.body.shop_id;
        } else if (existingRows[0].shop_id !== req.user.shopId) {
            return res.status(403).json({ error: 'You can only edit customers from your own shop' });
        }

        const { rows } = await pool.query(
            'UPDATE customers SET name=$1, phone=$2, address=$3, shop_id=$4 WHERE id=$5 RETURNING *',
            [name, phone || null, address || null, shop_id, req.params.id]
        );
        logActivity(req, 'update', 'customer', rows[0].id, `Updated customer "${name}"`);
        res.json(rows[0]);
    } catch (err) {
        if (err.code === '23503') return res.status(400).json({ error: 'shop_id does not exist' });
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// DELETE /api/customers/:id
router.delete('/:id', verifyToken, requireRole('Admin', 'Manager'), async (req, res) => {
    try {
        const { rows: existingRows } = await pool.query('SELECT shop_id, name FROM customers WHERE id = $1', [req.params.id]);
        if (!existingRows[0]) return res.status(404).json({ error: 'Customer not found' });

        if (req.user.role !== 'Admin' && existingRows[0].shop_id !== req.user.shopId) {
            return res.status(403).json({ error: 'You can only delete customers from your own shop' });
        }

        await pool.query('DELETE FROM customers WHERE id = $1', [req.params.id]);
        logActivity(req, 'delete', 'customer', req.params.id, `Deleted customer "${existingRows[0].name}"`);
        res.json({ message: 'Customer deleted' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
