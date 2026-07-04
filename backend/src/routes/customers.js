const express = require('express');
const pool    = require('../db/pool');
const { verifyToken, requireRole } = require('../middleware/auth');

const router = express.Router();

// GET /api/customers
router.get('/', verifyToken, async (req, res) => {
    try {
        const { rows } = await pool.query('SELECT * FROM customers ORDER BY name');
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/customers/:id
router.get('/:id', verifyToken, async (req, res) => {
    try {
        const { rows } = await pool.query('SELECT * FROM customers WHERE id = $1', [req.params.id]);
        if (!rows[0]) return res.status(404).json({ error: 'Customer not found' });
        res.json(rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/customers
router.post('/', verifyToken, requireRole('Admin', 'Manager', 'Cashier'), async (req, res) => {
    const { name, phone, address } = req.body;
    if (!name) return res.status(400).json({ error: 'Customer name is required' });

    try {
        const { rows } = await pool.query(
            'INSERT INTO customers (name, phone, address) VALUES ($1, $2, $3) RETURNING *',
            [name, phone || null, address || null]
        );
        res.status(201).json(rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PUT /api/customers/:id
router.put('/:id', verifyToken, requireRole('Admin', 'Manager', 'Cashier'), async (req, res) => {
    const { name, phone, address } = req.body;
    if (!name) return res.status(400).json({ error: 'Customer name is required' });

    try {
        const { rows } = await pool.query(
            'UPDATE customers SET name=$1, phone=$2, address=$3 WHERE id=$4 RETURNING *',
            [name, phone || null, address || null, req.params.id]
        );
        if (!rows[0]) return res.status(404).json({ error: 'Customer not found' });
        res.json(rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/customers/:id
router.delete('/:id', verifyToken, requireRole('Admin', 'Manager'), async (req, res) => {
    try {
        const { rowCount } = await pool.query('DELETE FROM customers WHERE id = $1', [req.params.id]);
        if (!rowCount) return res.status(404).json({ error: 'Customer not found' });
        res.json({ message: 'Customer deleted' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
