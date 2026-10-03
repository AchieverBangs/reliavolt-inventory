const jwt  = require('jsonwebtoken');
const pool = require('../db/pool');

function verifyToken(req, res, next) {
    const header = req.headers['authorization'];
    if (!header || !header.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'No token provided' });
    }
    const token = header.slice(7);
    try {
        req.user = jwt.verify(token, process.env.JWT_SECRET);
        next();
    } catch {
        return res.status(401).json({ error: 'Invalid or expired token' });
    }
}

function requireRole(...roles) {
    return (req, res, next) => {
        if (!roles.includes(req.user?.role)) {
            return res.status(403).json({ error: 'Access denied' });
        }
        next();
    };
}

// Global write gate, mounted once in app.js ahead of every route — so no individual
// route file needs to call it. Lets a user keep viewing every page while their
// can_write flag is off, but blocks any create/edit/delete with a clear message.
// Checked fresh from the DB on every request (not read from the token) so toggling it
// in Users takes effect immediately, even mid-session. Decodes the token itself rather
// than relying on req.user, since this runs before each route's own verifyToken — if
// the token is missing/invalid, it just steps aside and lets that route's own
// verifyToken produce the real 401, same as a request with no Authorization header at
// all (e.g. login) always has.
async function requireWrite(req, res, next) {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();

    const header = req.headers['authorization'];
    if (!header || !header.startsWith('Bearer ')) return next();

    let payload;
    try {
        payload = jwt.verify(header.slice(7), process.env.JWT_SECRET);
    } catch {
        return next();
    }
    if (payload.role === 'Admin') return next();

    try {
        const { rows } = await pool.query('SELECT can_write FROM users WHERE id = $1', [payload.id]);
        if (rows[0] && rows[0].can_write === false) {
            return res.status(403).json({ error: 'Your write access has been turned off by an Admin. You can still view everything, just not change it.' });
        }
        next();
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
}

module.exports = { verifyToken, requireRole, requireWrite };
