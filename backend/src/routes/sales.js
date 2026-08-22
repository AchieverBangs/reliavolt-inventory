const express = require('express');
const pool    = require('../db/pool');
const { verifyToken, requireRole } = require('../middleware/auth');

const router = express.Router();

// GET /api/sales  (optional ?from=&to= date filters; non-Admins are scoped to their own shop)
router.get('/', verifyToken, async (req, res) => {
    try {
        let query  = 'SELECT * FROM sales';
        const vals = [];
        const conditions = [];

        if (req.query.from) { vals.push(req.query.from); conditions.push(`sale_date >= $${vals.length}`); }
        if (req.query.to)   { vals.push(req.query.to);   conditions.push(`sale_date <= $${vals.length}`); }

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
        res.json(rows);
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
        res.json(sale);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/sales  — records a sale and decrements product quantity
router.post('/', verifyToken, requireRole('Admin', 'Manager', 'Cashier'), async (req, res) => {
    const { product_id, customer_id, customer_name, qty, payment_method } = req.body;
    if (!product_id || !qty) return res.status(400).json({ error: 'product_id and qty are required' });

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

        const unitPrice = parseFloat(product.selling_price);
        const unitCost  = parseFloat(product.cost_price);
        const total     = unitPrice * qty;
        const profit    = (unitPrice - unitCost) * qty;

        // Resolve customer name
        let cName = customer_name || 'Walk-in Customer';
        if (customer_id) {
            const { rows: cuRows } = await client.query('SELECT name FROM customers WHERE id=$1', [customer_id]);
            if (cuRows[0]) cName = cuRows[0].name;
        }

        const { rows } = await client.query(
            `INSERT INTO sales
             (receipt_no, product_id, product_name, customer_id, customer_name, qty,
              unit_price, unit_cost, total, profit, payment_method, shop_id, sale_date)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW()) RETURNING *`,
            [receiptNo, product_id, product.name, customer_id || null, cName,
             qty, unitPrice, unitCost, total, profit, payment_method || 'Cash', product.shop_id]
        );

        await client.query('COMMIT');
        res.status(201).json(rows[0]);
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(400).json({ error: err.message });
    } finally {
        client.release();
    }
});

// DELETE /api/sales/:id  (Admin only)
router.delete('/:id', verifyToken, requireRole('Admin'), async (req, res) => {
    try {
        const { rowCount } = await pool.query('DELETE FROM sales WHERE id = $1', [req.params.id]);
        if (!rowCount) return res.status(404).json({ error: 'Sale not found' });
        res.json({ message: 'Sale deleted' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
