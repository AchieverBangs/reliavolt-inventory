const express = require('express');
const pool    = require('../db/pool');
const { verifyToken, requireRole } = require('../middleware/auth');

const router = express.Router();

// GET /api/customers  (scoped to the caller's shop unless Admin; Admin may pass ?shop_id=)
router.get('/', verifyToken, async (req, res) => {
    try {
        let query = 'SELECT * FROM customers';
        const vals = [];

        if (req.user.role === 'Admin') {
            if (req.query.shop_id) {
                vals.push(req.query.shop_id);
                query += ` WHERE shop_id = $${vals.length}`;
            }
        } else {
            if (!req.user.shopId) return res.json([]);
            vals.push(req.user.shopId);
            query += ` WHERE shop_id = $${vals.length}`;
        }

        query += ' ORDER BY name';
        const { rows } = await pool.query(query, vals);
        res.json(rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/customers/:id
router.get('/:id', verifyToken, async (req, res) => {
    try {
        const { rows } = await pool.query('SELECT * FROM customers WHERE id = $1', [req.params.id]);
        const customer = rows[0];
        if (!customer) return res.status(404).json({ error: 'Customer not found' });
        if (req.user.role !== 'Admin' && customer.shop_id !== req.user.shopId) {
            return res.status(404).json({ error: 'Customer not found' });
        }
        res.json(customer);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Note: there is no POST / here on purpose — a customer record is only ever created
// automatically as a side effect of recording a sale (see sales.js). Editing/deleting
// an existing record (e.g. to fix a typo) is still allowed below.

// PUT /api/customers/:id
router.put('/:id', verifyToken, requireRole('Admin', 'Manager', 'Cashier'), async (req, res) => {
    const { name, phone, address } = req.body;
    if (!name) return res.status(400).json({ error: 'Customer name is required' });

    try {
        const { rows: existingRows } = await pool.query('SELECT shop_id FROM customers WHERE id = $1', [req.params.id]);
        if (!existingRows[0]) return res.status(404).json({ error: 'Customer not found' });

        let shop_id = existingRows[0].shop_id;
        if (req.user.role === 'Admin') {
            if (req.body.shop_id) shop_id = req.body.shop_id;
        } else if (existingRows[0].shop_id !== req.user.shopId) {
            return res.status(403).json({ error: 'You can only edit customers from your own shop' });
        }

        const { rows } = await pool.query(
            'UPDATE customers SET name=$1, phone=$2, address=$3, shop_id=$4 WHERE id=$5 RETURNING *',
            [name, phone || null, address || null, shop_id, req.params.id]
        );
        res.json(rows[0]);
    } catch (err) {
        if (err.code === '23503') return res.status(400).json({ error: 'shop_id does not exist' });
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// DELETE /api/customers/:id
router.delete('/:id', verifyToken, requireRole('Admin', 'Manager'), async (req, res) => {
    try {
        const { rows: existingRows } = await pool.query('SELECT shop_id FROM customers WHERE id = $1', [req.params.id]);
        if (!existingRows[0]) return res.status(404).json({ error: 'Customer not found' });

        if (req.user.role !== 'Admin' && existingRows[0].shop_id !== req.user.shopId) {
            return res.status(403).json({ error: 'You can only delete customers from your own shop' });
        }

        await pool.query('DELETE FROM customers WHERE id = $1', [req.params.id]);
        res.json({ message: 'Customer deleted' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
