const express = require('express');
const pool    = require('../db/pool');
const { verifyToken, requireRole } = require('../middleware/auth');

const router = express.Router();
const MGMT_ROLES = ['Admin', 'Manager'];

// GET /api/deliveries  (Delivery Person sees only their shop's deliveries)
router.get('/', verifyToken, async (req, res) => {
    try {
        let query = `SELECT d.*, json_agg(
                        json_build_object('product_name', di.product_name, 'qty', di.qty, 'price', di.price)
                     ) FILTER (WHERE di.id IS NOT NULL) AS products
                     FROM deliveries d
                     LEFT JOIN delivery_items di ON di.delivery_id = d.id`;
        const vals = [];

        if (req.user.role === 'Delivery Person' && req.user.shopId) {
            vals.push(req.user.shopId);
            query += ` WHERE d.from_shop_id = $1`;
        }

        query += ' GROUP BY d.id ORDER BY d.delivery_date DESC';
        const { rows } = await pool.query(query, vals);
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/deliveries/:id
router.get('/:id', verifyToken, async (req, res) => {
    try {
        const { rows } = await pool.query(
            `SELECT d.*, json_agg(
                json_build_object('product_name', di.product_name, 'qty', di.qty, 'price', di.price)
             ) FILTER (WHERE di.id IS NOT NULL) AS products
             FROM deliveries d
             LEFT JOIN delivery_items di ON di.delivery_id = d.id
             WHERE d.id = $1 GROUP BY d.id`,
            [req.params.id]
        );
        if (!rows[0]) return res.status(404).json({ error: 'Delivery not found' });
        res.json(rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/deliveries  (Admin / Manager)
router.post('/', verifyToken, requireRole(...MGMT_ROLES), async (req, res) => {
    const { type, from_shop_id, to_name, to_address, to_shop_id, products, driver, phone, notes } = req.body;
    if (!from_shop_id || !to_name) return res.status(400).json({ error: 'from_shop_id and to_name are required' });

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const { rows: cntRows } = await client.query('SELECT COUNT(*) FROM deliveries');
        const deliveryNo = `DLV-${String(parseInt(cntRows[0].count) + 1).padStart(3, '0')}`;

        const total = Array.isArray(products)
            ? products.reduce((s, p) => s + (p.price || 0) * (p.qty || 0), 0)
            : 0;

        const { rows } = await client.query(
            `INSERT INTO deliveries
             (delivery_no, type, from_shop_id, to_name, to_address, to_shop_id, total, driver, phone, notes)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
            [deliveryNo, type || 'Customer Delivery', from_shop_id, to_name,
             to_address || null, to_shop_id || null, total, driver || null, phone || null, notes || null]
        );
        const deliveryId = rows[0].id;

        if (Array.isArray(products) && products.length) {
            for (const p of products) {
                await client.query(
                    'INSERT INTO delivery_items (delivery_id, product_name, qty, price) VALUES ($1,$2,$3,$4)',
                    [deliveryId, p.product_name || p.name, p.qty, p.price]
                );
            }
        }

        await client.query('COMMIT');

        // Fetch with items to return
        const { rows: full } = await client.query(
            `SELECT d.*, json_agg(
                json_build_object('product_name', di.product_name, 'qty', di.qty, 'price', di.price)
             ) FILTER (WHERE di.id IS NOT NULL) AS products
             FROM deliveries d LEFT JOIN delivery_items di ON di.delivery_id = d.id
             WHERE d.id = $1 GROUP BY d.id`,
            [deliveryId]
        );
        res.status(201).json(full[0]);
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
});

// PATCH /api/deliveries/:id/status  — update status (Delivery Person can update their own)
router.patch('/:id/status', verifyToken, async (req, res) => {
    const { status } = req.body;
    const allowed = ['Pending', 'In Transit', 'Delivered', 'Cancelled'];
    if (!allowed.includes(status)) return res.status(400).json({ error: 'Invalid status' });

    try {
        const { rows } = await pool.query('SELECT * FROM deliveries WHERE id = $1', [req.params.id]);
        if (!rows[0]) return res.status(404).json({ error: 'Delivery not found' });

        // Delivery Person may only update deliveries from their shop
        const d = rows[0];
        if (req.user.role === 'Delivery Person' && d.from_shop_id !== req.user.shopId) {
            return res.status(403).json({ error: 'Access denied' });
        }

        const { rows: updated } = await pool.query(
            'UPDATE deliveries SET status=$1 WHERE id=$2 RETURNING *',
            [status, req.params.id]
        );
        res.json(updated[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/deliveries/:id  (Admin only)
router.delete('/:id', verifyToken, requireRole('Admin'), async (req, res) => {
    try {
        const { rowCount } = await pool.query('DELETE FROM deliveries WHERE id = $1', [req.params.id]);
        if (!rowCount) return res.status(404).json({ error: 'Delivery not found' });
        res.json({ message: 'Delivery deleted' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
