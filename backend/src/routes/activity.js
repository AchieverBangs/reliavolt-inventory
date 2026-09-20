const express = require('express');
const pool    = require('../db/pool');
const { verifyToken, requireRole } = require('../middleware/auth');

const router = express.Router();

// GET /api/activity  (Admin only) — system-wide log, most recent first.
// Optional filters: ?action=create|update|delete  &entity_type=product|sale|customer|user|shop|delivery|settings
router.get('/', verifyToken, requireRole('Admin'), async (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit) || 200, 500);
        const conditions = [];
        const vals = [];

        if (req.query.action)      { vals.push(req.query.action);      conditions.push(`action = $${vals.length}`); }
        if (req.query.entity_type) { vals.push(req.query.entity_type); conditions.push(`entity_type = $${vals.length}`); }

        let query = 'SELECT * FROM activity_log';
        if (conditions.length) query += ' WHERE ' + conditions.join(' AND ');
        vals.push(limit);
        query += ` ORDER BY created_at DESC LIMIT $${vals.length}`;

        const { rows } = await pool.query(query, vals);
        res.json(rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
