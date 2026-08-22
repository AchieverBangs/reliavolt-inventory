const express = require('express');
const pool    = require('../db/pool');
const { verifyToken, requireRole } = require('../middleware/auth');

const router = express.Router();
const STOCK_ROLES = ['Admin', 'Manager', 'Stock Manager'];

const PRODUCT_SELECT = `SELECT p.*, s.name AS shop_name FROM products p LEFT JOIN shops s ON s.id = p.shop_id`;

// GET /api/products  (scoped to the caller's shop unless Admin; Admin may pass ?shop_id=)
router.get('/', verifyToken, async (req, res) => {
    try {
        let query = PRODUCT_SELECT;
        const vals = [];

        if (req.user.role === 'Admin') {
            if (req.query.shop_id) {
                vals.push(req.query.shop_id);
                query += ` WHERE p.shop_id = $${vals.length}`;
            }
        } else {
            if (!req.user.shopId) return res.json([]);
            vals.push(req.user.shopId);
            query += ` WHERE p.shop_id = $${vals.length}`;
        }

        query += ' ORDER BY p.name';
        const { rows } = await pool.query(query, vals);
        res.json(rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/products/summary/by-shop  (Admin only — total products added per shop + grand total)
router.get('/summary/by-shop', verifyToken, requireRole('Admin'), async (req, res) => {
    try {
        const { rows } = await pool.query(
            `SELECT s.id AS shop_id, s.name AS shop_name,
                    COUNT(p.id)::int AS product_count,
                    COALESCE(SUM(p.quantity), 0)::int AS total_quantity
             FROM shops s
             LEFT JOIN products p ON p.shop_id = s.id
             GROUP BY s.id, s.name
             ORDER BY s.name`
        );
        const grandTotal = rows.reduce((acc, r) => ({
            product_count:  acc.product_count  + r.product_count,
            total_quantity: acc.total_quantity + r.total_quantity,
        }), { product_count: 0, total_quantity: 0 });

        res.json({ shops: rows, grandTotal });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/products/:id
router.get('/:id', verifyToken, async (req, res) => {
    try {
        const { rows } = await pool.query(`${PRODUCT_SELECT} WHERE p.id = $1`, [req.params.id]);
        const product = rows[0];
        if (!product) return res.status(404).json({ error: 'Product not found' });
        if (req.user.role !== 'Admin' && product.shop_id !== req.user.shopId) {
            return res.status(404).json({ error: 'Product not found' });
        }
        res.json(product);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/products
router.post('/', verifyToken, requireRole(...STOCK_ROLES), async (req, res) => {
    const { name, category, brand, cost_price, selling_price, quantity, icon } = req.body;
    if (!name) return res.status(400).json({ error: 'Product name is required' });

    // Non-admins can only add to their own shop; Admins must specify one
    let shop_id;
    if (req.user.role === 'Admin') {
        shop_id = req.body.shop_id;
        if (!shop_id) return res.status(400).json({ error: 'shop_id is required' });
    } else {
        if (!req.user.shopId) return res.status(400).json({ error: 'Your account has no shop assigned' });
        shop_id = req.user.shopId;
    }

    try {
        const { rows } = await pool.query(
            `INSERT INTO products (name, category, brand, cost_price, selling_price, quantity, icon, shop_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
            [name, category || null, brand || null, cost_price || 0, selling_price || 0, quantity || 0, icon || '📦', shop_id]
        );
        res.status(201).json(rows[0]);
    } catch (err) {
        if (err.code === '23503') return res.status(400).json({ error: 'shop_id does not exist' });
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// PUT /api/products/:id
router.put('/:id', verifyToken, requireRole(...STOCK_ROLES), async (req, res) => {
    const { name, category, brand, cost_price, selling_price, quantity, icon } = req.body;
    if (!name) return res.status(400).json({ error: 'Product name is required' });

    try {
        const { rows: existingRows } = await pool.query('SELECT shop_id FROM products WHERE id = $1', [req.params.id]);
        if (!existingRows[0]) return res.status(404).json({ error: 'Product not found' });

        let shop_id = existingRows[0].shop_id;
        if (req.user.role === 'Admin') {
            if (req.body.shop_id) shop_id = req.body.shop_id;
        } else if (existingRows[0].shop_id !== req.user.shopId) {
            return res.status(403).json({ error: 'You can only edit products from your own shop' });
        }

        const { rows } = await pool.query(
            `UPDATE products SET name=$1, category=$2, brand=$3, cost_price=$4,
             selling_price=$5, quantity=$6, icon=$7, shop_id=$8 WHERE id=$9 RETURNING *`,
            [name, category || null, brand || null, cost_price || 0, selling_price || 0, quantity || 0, icon || '📦', shop_id, req.params.id]
        );
        res.json(rows[0]);
    } catch (err) {
        if (err.code === '23503') return res.status(400).json({ error: 'shop_id does not exist' });
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// DELETE /api/products/:id
router.delete('/:id', verifyToken, requireRole('Admin', 'Manager'), async (req, res) => {
    try {
        const { rows: existingRows } = await pool.query('SELECT shop_id FROM products WHERE id = $1', [req.params.id]);
        if (!existingRows[0]) return res.status(404).json({ error: 'Product not found' });

        if (req.user.role !== 'Admin' && existingRows[0].shop_id !== req.user.shopId) {
            return res.status(403).json({ error: 'You can only delete products from your own shop' });
        }

        await pool.query('DELETE FROM products WHERE id = $1', [req.params.id]);
        res.json({ message: 'Product deleted' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
