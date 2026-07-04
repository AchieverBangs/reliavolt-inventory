const express = require('express');
const pool    = require('../db/pool');
const { verifyToken, requireRole } = require('../middleware/auth');

const router = express.Router();

// GET /api/shops
router.get('/', verifyToken, async (req, res) => {
    try {
        const { rows } = await pool.query('SELECT * FROM shops ORDER BY name');
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/shops  (Admin only)
router.post('/', verifyToken, requireRole('Admin'), async (req, res) => {
    const { name, address, phone, manager, status } = req.body;
    if (!name || !address) return res.status(400).json({ error: 'Name and address are required' });

    try {
        const { rows } = await pool.query(
            'INSERT INTO shops (name, address, phone, manager, status) VALUES ($1,$2,$3,$4,$5) RETURNING *',
            [name, address, phone || null, manager || null, status || 'Active']
        );
        res.status(201).json(rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PUT /api/shops/:id  (Admin only)
router.put('/:id', verifyToken, requireRole('Admin'), async (req, res) => {
    const { name, address, phone, manager, status } = req.body;
    if (!name || !address) return res.status(400).json({ error: 'Name and address are required' });

    try {
        const { rows } = await pool.query(
            'UPDATE shops SET name=$1, address=$2, phone=$3, manager=$4, status=$5 WHERE id=$6 RETURNING *',
            [name, address, phone || null, manager || null, status || 'Active', req.params.id]
        );
        if (!rows[0]) return res.status(404).json({ error: 'Shop not found' });
        res.json(rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/shops/:id  (Admin only)
router.delete('/:id', verifyToken, requireRole('Admin'), async (req, res) => {
    try {
        // Unassign users from this shop first
        await pool.query('UPDATE users SET shop_id = NULL WHERE shop_id = $1', [req.params.id]);
        const { rowCount } = await pool.query('DELETE FROM shops WHERE id = $1', [req.params.id]);
        if (!rowCount) return res.status(404).json({ error: 'Shop not found' });
        res.json({ message: 'Shop deleted' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
