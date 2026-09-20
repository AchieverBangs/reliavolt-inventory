const pool = require('../db/pool');

// Fire-and-forget — an audit trail write should never block or fail the request it's logging.
function logActivity(req, action, entityType, entityId, description) {
    const user = req.user || {};
    pool.query(
        `INSERT INTO activity_log (user_id, username, name, role, action, entity_type, entity_id, description)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [user.id || null, user.username || null, user.name || null, user.role || null, action, entityType, entityId || null, description || null]
    ).catch(err => console.error('activity log failed:', err.message));
}

module.exports = { logActivity };
