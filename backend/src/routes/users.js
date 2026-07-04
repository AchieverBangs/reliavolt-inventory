const express = require('express');
const bcrypt  = require('bcryptjs');
const pool    = require('../db/pool');
const { verifyToken, requireRole } = require('../middleware/auth');

const router = express.Router();

// GET /api/users  (Admin only)
router.get('/', verifyToken, requireRole('Admin'), async (req, res) => {
    try {
        const { rows } = await pool.query(
            'SELECT id, name, username, role, shop_id, status, created_at FROM users ORDER BY name'
        );
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/users  (Admin only)
router.post('/', verifyToken, requireRole('Admin'), async (req, res) => {
    const { name, username, password, role, shop_id, status } = req.body;
    if (!name || !username || !password) {
        return res.status(400).json({ error: 'Name, username and password are required' });
    }
    if (password.length < 6) {
        return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    try {
        const hash = await bcrypt.hash(password, 10);
        const { rows } = await pool.query(
            `INSERT INTO users (name, username, password_hash, role, shop_id, status)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING id, name, username, role, shop_id, status, created_at`,
            [name, username.toLowerCase().trim(), hash, role || 'Cashier', shop_id || null, status || 'Active']
        );
        res.status(201).json(rows[0]);
    } catch (err) {
        if (err.code === '23505') return res.status(409).json({ error: 'Username already taken' });
        res.status(500).json({ error: err.message });
    }
});

// PUT /api/users/:id  (Admin only)
router.put('/:id', verifyToken, requireRole('Admin'), async (req, res) => {
    const { name, username, password, role, shop_id, status } = req.body;
    if (!name || !username) return res.status(400).json({ error: 'Name and username are required' });

    try {
        let query, values;
        if (password) {
            const hash = await bcrypt.hash(password, 10);
            query  = `UPDATE users SET name=$1, username=$2, password_hash=$3, role=$4, shop_id=$5, status=$6
                      WHERE id=$7 RETURNING id, name, username, role, shop_id, status, created_at`;
            values = [name, username.toLowerCase().trim(), hash, role, shop_id || null, status, req.params.id];
        } else {
            query  = `UPDATE users SET name=$1, username=$2, role=$3, shop_id=$4, status=$5
                      WHERE id=$6 RETURNING id, name, username, role, shop_id, status, created_at`;
            values = [name, username.toLowerCase().trim(), role, shop_id || null, status, req.params.id];
        }

        const { rows } = await pool.query(query, values);
        if (!rows[0]) return res.status(404).json({ error: 'User not found' });
        res.json(rows[0]);
    } catch (err) {
        if (err.code === '23505') return res.status(409).json({ error: 'Username already taken' });
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/users/:id  (Admin only, cannot delete self)
router.delete('/:id', verifyToken, requireRole('Admin'), async (req, res) => {
    if (parseInt(req.params.id) === req.user.id) {
        return res.status(400).json({ error: 'You cannot delete your own account' });
    }
    try {
        const { rowCount } = await pool.query('DELETE FROM users WHERE id = $1', [req.params.id]);
        if (!rowCount) return res.status(404).json({ error: 'User not found' });
        res.json({ message: 'User deleted' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
