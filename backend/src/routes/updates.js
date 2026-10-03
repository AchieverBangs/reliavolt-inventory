const express = require('express');
const pool    = require('../db/pool');
const { verifyToken } = require('../middleware/auth');

const router = express.Router();

// GET /api/updates/unread — announcements newer than what this user has already seen.
router.get('/unread', verifyToken, async (req, res) => {
    try {
        const { rows } = await pool.query(
            `SELECT id, title, body, created_at FROM app_updates
             WHERE id > (SELECT last_seen_update_id FROM users WHERE id = $1)
             ORDER BY id ASC`,
            [req.user.id]
        );
        res.json(rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/updates/mark-seen — caller has now seen everything up to the latest update.
router.post('/mark-seen', verifyToken, async (req, res) => {
    try {
        await pool.query(
            `UPDATE users SET last_seen_update_id = (SELECT COALESCE(MAX(id), 0) FROM app_updates) WHERE id = $1`,
            [req.user.id]
        );
        res.json({ ok: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
