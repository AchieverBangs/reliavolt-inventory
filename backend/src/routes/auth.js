const express = require('express');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const crypto  = require('crypto');
const pool    = require('../db/pool');
const { verifyToken } = require('../middleware/auth');
const { sendPasswordReset } = require('../services/email');

const router = express.Router();

// POST /api/auth/login
router.post('/login', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password are required' });
    }

    try {
        const { rows } = await pool.query(
            'SELECT * FROM users WHERE username = $1 AND status = $2',
            [username.toLowerCase().trim(), 'Active']
        );
        const user = rows[0];
        if (!user) return res.status(401).json({ error: 'Invalid credentials' });

        const valid = await bcrypt.compare(password, user.password_hash);
        if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

        const token = jwt.sign(
            { id: user.id, username: user.username, name: user.name, role: user.role, shopId: user.shop_id },
            process.env.JWT_SECRET,
            { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
        );

        res.json({
            token,
            user: { id: user.id, name: user.name, username: user.username, role: user.role, shopId: user.shop_id },
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
});

// GET /api/auth/me  — verify token and return current user
router.get('/me', verifyToken, async (req, res) => {
    try {
        const { rows } = await pool.query(
            'SELECT id, name, username, email, role, shop_id FROM users WHERE id = $1',
            [req.user.id]
        );
        res.json({ user: rows[0] || req.user });
    } catch { res.json({ user: req.user }); }
});

// PATCH /api/auth/profile  — update own email / password
router.patch('/profile', verifyToken, async (req, res) => {
    const { email, currentPassword, newPassword } = req.body;

    try {
        const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [req.user.id]);
        const user = rows[0];
        if (!user) return res.status(404).json({ error: 'User not found' });

        let hash = user.password_hash;

        if (newPassword) {
            if (!currentPassword) return res.status(400).json({ error: 'Current password is required to set a new one' });
            if (newPassword.length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters' });
            const valid = await bcrypt.compare(currentPassword, hash);
            if (!valid) return res.status(400).json({ error: 'Current password is incorrect' });
            hash = await bcrypt.hash(newPassword, 10);
        }

        const { rows: updated } = await pool.query(
            'UPDATE users SET email = $1, password_hash = $2 WHERE id = $3 RETURNING id, name, username, email, role, shop_id',
            [email || null, hash, req.user.id]
        );
        res.json({ user: updated[0], message: 'Profile updated successfully' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/auth/forgot-password
router.post('/forgot-password', async (req, res) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required' });

    // Always return the same message to avoid revealing registered emails
    const ok = { message: 'If that email is registered, a reset link has been sent.' };

    try {
        const { rows } = await pool.query(
            "SELECT id, name, email FROM users WHERE LOWER(email) = $1 AND status = 'Active'",
            [email.toLowerCase().trim()]
        );
        if (!rows[0]) return res.json(ok);

        const user  = rows[0];
        const token = crypto.randomBytes(32).toString('hex');
        const exp   = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

        await pool.query('DELETE FROM password_reset_tokens WHERE user_id = $1', [user.id]);
        await pool.query(
            'INSERT INTO password_reset_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)',
            [user.id, token, exp]
        );

        const base = process.env.FRONTEND_URL || 'https://achieverbangs.github.io/reliavolt-inventory/Reliavolt-Inventory-Frontend';
        await sendPasswordReset(user.email, user.name, `${base}/reset-password.html?token=${token}`);

        res.json(ok);
    } catch (err) {
        console.error('Forgot-password error:', err.message);
        res.status(500).json({ error: 'Failed to send reset email. Check server email config.' });
    }
});

// POST /api/auth/reset-password
router.post('/reset-password', async (req, res) => {
    const { token, password } = req.body;
    if (!token || !password) return res.status(400).json({ error: 'Token and password are required' });
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

    try {
        const { rows } = await pool.query(
            `SELECT prt.id, prt.user_id FROM password_reset_tokens prt
             WHERE prt.token = $1 AND prt.used = FALSE AND prt.expires_at > NOW()`,
            [token]
        );
        if (!rows[0]) return res.status(400).json({ error: 'This reset link is invalid or has expired.' });

        const { id: tokenId, user_id } = rows[0];
        const hash = await bcrypt.hash(password, 10);

        await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, user_id]);
        await pool.query('UPDATE password_reset_tokens SET used = TRUE WHERE id = $1', [tokenId]);

        res.json({ message: 'Password reset successfully. You can now log in.' });
    } catch (err) {
        console.error('Reset-password error:', err.message);
        res.status(500).json({ error: 'Failed to reset password. Please try again.' });
    }
});

module.exports = router;
