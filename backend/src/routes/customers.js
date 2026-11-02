const express = require('express');
const pool    = require('../db/pool');
const { verifyToken, requireRole, requirePermission } = require('../middleware/auth');
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

// GET /api/customers/credit — current balances by default; ?history=1 includes
// settled accounts with credit sales or repayments. Shop scope applies to both.
router.get('/credit', verifyToken, async (req, res) => {
    try {
        let query = `SELECT c.*, s.name AS shop_name FROM customers c
                      LEFT JOIN shops s ON s.id = c.shop_id
                      WHERE ${req.query.history === '1' ? `(c.credit_balance > 0
                          OR EXISTS (SELECT 1 FROM sales cs WHERE cs.customer_id = c.id AND (cs.credit_amount > 0 OR cs.payment_method = 'Credit'))
                          OR EXISTS (SELECT 1 FROM credit_payments cp WHERE cp.customer_id = c.id))` : 'c.credit_balance > 0'}`;
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
            `SELECT 'sale' AS type, id, receipt_no, COALESCE(invoice_no, receipt_no) AS invoice_no, product_name, qty,
                    unit_price, total, credit_amount_paid, credit_amount AS amount, sale_date AS at
             FROM sales WHERE customer_id = $1 AND (credit_amount > 0 OR payment_method = 'Credit')`,
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

// Admin correction of one credit invoice line. Preserve the original deposit and
// repayment allocations; a correction must never turn collected money into an
// untracked overpayment. Lock the customer before the sale, as repayments do.
router.put('/:id/credit-items/:saleId', verifyToken, requireRole('Admin'), async (req, res) => {
    const qty = Number(req.body.qty);
    const priceText = String(req.body.unit_price ?? '');
    const priceCents = Math.round(Number(priceText) * 100);
    if (!Number.isSafeInteger(qty) || qty <= 0 || qty > 2147483647 ||
        !/^\d+(\.\d{1,2})?$/.test(priceText) || !Number.isSafeInteger(priceCents) || priceCents <= 0 ||
        !Number.isSafeInteger(qty * priceCents) || qty * priceCents > 99999999999999) {
        return res.status(400).json({ error: 'Enter a positive whole quantity and a positive unit price with at most two decimal places' });
    }
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { rows: customers } = await client.query(
            'SELECT id, credit_balance FROM customers WHERE id = $1 FOR UPDATE', [req.params.id]);
        if (!customers[0]) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Customer not found' }); }
        const { rows: sales } = await client.query(
            'SELECT * FROM sales WHERE id = $1 AND customer_id = $2 FOR UPDATE', [req.params.saleId, req.params.id]);
        const sale = sales[0];
        if (!sale || (Number(sale.credit_amount) <= 0 && sale.payment_method !== 'Credit')) {
            await client.query('ROLLBACK'); return res.status(404).json({ error: 'Credit item not found' });
        }
        const totalCents = qty * priceCents;
        const oldTotalCents = Math.round(Number(sale.total) * 100);
        const depositCents = oldTotalCents - Math.round(Number(sale.credit_amount) * 100);
        const paidCents = Math.round(Number(sale.credit_amount_paid) * 100);
        if (totalCents < depositCents + paidCents) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'The item total cannot be less than its deposit and repayments. Reverse the relevant payment first.' });
        }
        const stockChange = sale.qty - qty;
        if (stockChange !== 0) {
            const { rows: products } = await client.query('SELECT id, quantity FROM products WHERE id = $1 FOR UPDATE', [sale.product_id]);
            if (!products[0]) {
                await client.query('ROLLBACK'); return res.status(400).json({ error: 'The original product no longer exists; its quantity cannot be changed' });
            }
            const stock = products[0].quantity + stockChange;
            if (stock < 0 || stock > 2147483647) {
                await client.query('ROLLBACK'); return res.status(400).json({ error: 'Insufficient stock or invalid resulting stock quantity' });
            }
            await client.query('UPDATE products SET quantity = $1 WHERE id = $2', [stock, sale.product_id]);
            await client.query(
                `INSERT INTO stock_movements (product_id, type, qty_change, balance_after, note, user_id, sale_id)
                 VALUES ($1, 'adjustment', $2, $3, $4, $5, $6)`,
                [sale.product_id, stockChange, stock, `Edited credit item, receipt ${sale.receipt_no}: quantity ${sale.qty} to ${qty}`, req.user.id, sale.id]);
        }
        // Use the captured sale cost and commission per unit, not today's product rates.
        const { rows: updated } = await client.query(
            `UPDATE sales SET qty=$1::int, unit_price=$2, total=$3::numeric,
                profit=$3::numeric - unit_cost * $1::int, commission=ROUND(commission / qty * $1::int, 2),
                credit_amount=$4 WHERE id=$5 RETURNING *`,
            [qty, (priceCents / 100).toFixed(2), (totalCents / 100).toFixed(2),
                ((totalCents - depositCents) / 100).toFixed(2), sale.id]);
        await client.query('UPDATE customers SET credit_balance = credit_balance + $1 WHERE id = $2',
            [((totalCents - oldTotalCents) / 100).toFixed(2), customers[0].id]);
        await client.query('COMMIT');
        logActivity(req, 'update', 'sale', sale.id,
            `Edited credit item ${sale.receipt_no}: qty ${sale.qty} to ${qty}, unit price ${sale.unit_price} to ${(priceCents / 100).toFixed(2)}`);
        res.json(updated[0]);
    } catch (err) {
        await client.query('ROLLBACK');
        console.error(err);
        res.status(500).json({ error: 'Unable to update credit item' });
    } finally { client.release(); }
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
        const { rows: payment } = await client.query(
            `INSERT INTO credit_payments (customer_id, amount, note, shop_id, user_id, paid_at)
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
            [customer.id, amt, note || null, customer.shop_id, req.user.id, paidAt]
        );

        // Record exactly which sale(s) this payment paid down, and by how much, so it
        // can later be reversed precisely (see DELETE /:id/credit-payments/:paymentId).
        let remaining = amt;
        for (const sale of openSales) {
            if (remaining <= 0) break;
            const owed = parseFloat(sale.credit_amount) - parseFloat(sale.credit_amount_paid);
            const apply = Math.min(remaining, owed);
            if (apply > 0) {
                await client.query('UPDATE sales SET credit_amount_paid = credit_amount_paid + $1 WHERE id = $2', [apply, sale.id]);
                await client.query(
                    'INSERT INTO credit_payment_allocations (payment_id, sale_id, amount) VALUES ($1, $2, $3)',
                    [payment[0].id, sale.id, apply]
                );
                remaining -= apply;
            }
        }

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

// DELETE /api/customers/:id/credit-payments/:paymentId — reverse a payment, present or
// previous: gives each sale it had paid down back its credit_amount_paid (so
// earned_commission recomputes back down too, undoing any commission it had released),
// restores the customer's credit_balance, and removes the payment. Gated by the
// Customers Delete permission (same one as deleting a customer record); a non-Admin is
// still restricted to their own shop regardless.
router.delete('/:id/credit-payments/:paymentId', verifyToken, requirePermission('customers', 'delete'), async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const { rows: cRows } = await client.query('SELECT id, name, shop_id, credit_balance FROM customers WHERE id = $1 FOR UPDATE', [req.params.id]);
        const customer = cRows[0];
        if (!customer) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Customer not found' }); }
        if (req.user.role !== 'Admin' && customer.shop_id !== req.user.shopId) {
            await client.query('ROLLBACK');
            return res.status(403).json({ error: 'You can only reverse payments for customers from your own shop' });
        }

        const { rows: payRows } = await client.query(
            'SELECT * FROM credit_payments WHERE id = $1 AND customer_id = $2 FOR UPDATE',
            [req.params.paymentId, customer.id]
        );
        const payment = payRows[0];
        if (!payment) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Payment not found' }); }

        const { rows: allocations } = await client.query(
            'SELECT sale_id, amount FROM credit_payment_allocations WHERE payment_id = $1',
            [payment.id]
        );
        for (const alloc of allocations) {
            await client.query('UPDATE sales SET credit_amount_paid = credit_amount_paid - $1 WHERE id = $2', [alloc.amount, alloc.sale_id]);
        }
        await client.query('DELETE FROM credit_payment_allocations WHERE payment_id = $1', [payment.id]);

        const newBalance = parseFloat(customer.credit_balance) + parseFloat(payment.amount);
        await client.query('UPDATE customers SET credit_balance = $1 WHERE id = $2', [newBalance, customer.id]);
        await client.query('DELETE FROM credit_payments WHERE id = $1', [payment.id]);

        await client.query('COMMIT');
        logActivity(req, 'delete', 'credit_payment', payment.id, `Reversed Le ${payment.amount} credit payment from "${customer.name}"`);
        res.json({ message: 'Payment reversed', newBalance });
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
router.put('/:id', verifyToken, requirePermission('customers', 'edit'), async (req, res) => {
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
router.delete('/:id', verifyToken, requirePermission('customers', 'delete'), async (req, res) => {
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
