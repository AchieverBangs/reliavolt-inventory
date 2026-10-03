const express = require('express');
const pool    = require('../db/pool');
const { verifyToken, requireRole } = require('../middleware/auth');
const { logActivity } = require('../services/activityLog');

const router = express.Router();

const VALID_ROLES   = ['Manager', 'Cashier', 'Stock Manager', 'Delivery Person'];
const VALID_AREAS   = ['sales', 'products', 'customers', 'deliveries'];
const VALID_ACTIONS = ['edit', 'delete'];

// GET /api/role-permissions  (Admin only) — the full role x area x action grid
router.get('/', verifyToken, requireRole('Admin'), async (req, res) => {
    try {
        const { rows } = await pool.query('SELECT role, area, action, allowed FROM role_permissions ORDER BY role, area, action');
        res.json(rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// PATCH /api/role-permissions  { role, area, action, allowed }  (Admin only) — flips one
// cell of the grid. Admin itself is never a valid target — it's always exempt, there's
// nothing to toggle.
router.patch('/', verifyToken, requireRole('Admin'), async (req, res) => {
    const { role, area, action } = req.body;
    const allowed = !!req.body.allowed;
    if (!VALID_ROLES.includes(role) || !VALID_AREAS.includes(area) || !VALID_ACTIONS.includes(action)) {
        return res.status(400).json({ error: 'Invalid role, area, or action' });
    }

    try {
        const { rows } = await pool.query(
            `INSERT INTO role_permissions (role, area, action, allowed) VALUES ($1, $2, $3, $4)
             ON CONFLICT (role, area, action) DO UPDATE SET allowed = $4
             RETURNING role, area, action, allowed`,
            [role, area, action, allowed]
        );
        logActivity(req, 'update', 'role_permission', null, `${allowed ? 'Granted' : 'Revoked'} ${role} → ${action} ${area}`);
        res.json(rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
