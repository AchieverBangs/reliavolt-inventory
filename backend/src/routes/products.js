const express = require('express');
const pool    = require('../db/pool');
const { verifyToken, requireRole } = require('../middleware/auth');

const router = express.Router();
const STOCK_ROLES = ['Admin', 'Manager', 'Stock Manager'];

// GET /api/products
router.get('/', verifyToken, async (req, res) => {
    try {
        const { rows } = await pool.query('SELECT * FROM products ORDER BY name');
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/products/:id
router.get('/:id', verifyToken, async (req, res) => {
    try {
        const { rows } = await pool.query('SELECT * FROM products WHERE id = $1', [req.params.id]);
        if (!rows[0]) return res.status(404).json({ error: 'Product not found' });
        res.json(rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/products
router.post('/', verifyToken, requireRole(...STOCK_ROLES), async (req, res) => {
    const { name, category, brand, cost_price, selling_price, quantity, icon } = req.body;
    if (!name) return res.status(400).json({ error: 'Product name is required' });

    try {
        const { rows } = await pool.query(
            `INSERT INTO products (name, category, brand, cost_price, selling_price, quantity, icon)
             VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
            [name, category || null, brand || null, cost_price || 0, selling_price || 0, quantity || 0, icon || '📦']
        );
        res.status(201).json(rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PUT /api/products/:id
router.put('/:id', verifyToken, requireRole(...STOCK_ROLES), async (req, res) => {
    const { name, category, brand, cost_price, selling_price, quantity, icon } = req.body;
    if (!name) return res.status(400).json({ error: 'Product name is required' });

    try {
        const { rows } = await pool.query(
            `UPDATE products SET name=$1, category=$2, brand=$3, cost_price=$4,
             selling_price=$5, quantity=$6, icon=$7 WHERE id=$8 RETURNING *`,
            [name, category || null, brand || null, cost_price || 0, selling_price || 0, quantity || 0, icon || '📦', req.params.id]
        );
        if (!rows[0]) return res.status(404).json({ error: 'Product not found' });
        res.json(rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/products/:id
router.delete('/:id', verifyToken, requireRole('Admin', 'Manager'), async (req, res) => {
    try {
        const { rowCount } = await pool.query('DELETE FROM products WHERE id = $1', [req.params.id]);
        if (!rowCount) return res.status(404).json({ error: 'Product not found' });
        res.json({ message: 'Product deleted' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
