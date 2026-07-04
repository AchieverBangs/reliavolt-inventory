const express = require('express');
const pool    = require('../db/pool');
const { verifyToken, requireRole } = require('../middleware/auth');

const router = express.Router();

// GET /api/settings
router.get('/', verifyToken, async (req, res) => {
    try {
        const { rows } = await pool.query('SELECT * FROM settings WHERE id = 1');
        res.json(rows[0] || {});
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PUT /api/settings  (Admin only)
router.put('/', verifyToken, requireRole('Admin'), async (req, res) => {
    const { company_name, currency, receipt_footer, theme } = req.body;

    try {
        const { rows } = await pool.query(
            `INSERT INTO settings (id, company_name, currency, receipt_footer, theme)
             VALUES (1, $1, $2, $3, $4)
             ON CONFLICT (id) DO UPDATE SET
               company_name   = EXCLUDED.company_name,
               currency       = EXCLUDED.currency,
               receipt_footer = EXCLUDED.receipt_footer,
               theme          = EXCLUDED.theme
             RETURNING *`,
            [company_name || 'Reliavolt Supply', currency || 'Le', receipt_footer || '', theme || 'light']
        );
        res.json(rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
