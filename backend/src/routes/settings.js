const express = require('express');
const pool    = require('../db/pool');
const { verifyToken, requireRole } = require('../middleware/auth');
const { logActivity } = require('../services/activityLog');

const router = express.Router();

// GET /api/settings
router.get('/', verifyToken, async (req, res) => {
    try {
        const { rows } = await pool.query('SELECT * FROM settings WHERE id = 1');
        res.json(rows[0] || {});
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// PUT /api/settings  (Admin only)
router.put('/', verifyToken, requireRole('Admin'), async (req, res) => {
    const { company_name, currency, receipt_footer, theme, company_address, company_phone } = req.body;

    try {
        const { rows } = await pool.query(
            `INSERT INTO settings (id, company_name, currency, receipt_footer, theme, company_address, company_phone)
             VALUES (1, $1, $2, $3, $4, $5, $6)
             ON CONFLICT (id) DO UPDATE SET
               company_name   = EXCLUDED.company_name,
               currency       = EXCLUDED.currency,
               receipt_footer = EXCLUDED.receipt_footer,
               theme          = EXCLUDED.theme,
               company_address = EXCLUDED.company_address,
               company_phone   = EXCLUDED.company_phone
             RETURNING *`,
            [company_name || 'Reliavolt Supply', currency || 'Le', receipt_footer || '', theme || 'light', company_address || '', company_phone || '']
        );
        logActivity(req, 'update', 'settings', 1, 'Updated app settings');
        res.json(rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
