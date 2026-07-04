const fs   = require('fs');
const path = require('path');
const pool = require('./pool');

/**
 * Reads schema.sql and executes it against the database pool.
 * All CREATE TABLE statements use IF NOT EXISTS and all INSERTs use
 * ON CONFLICT DO NOTHING, so this function is fully idempotent and
 * safe to call on every startup — even when the schema already exists.
 */
async function initDb() {
    const schemaPath = path.join(__dirname, '..', '..', '..', 'schema.sql');

    let sql;
    try {
        sql = fs.readFileSync(schemaPath, 'utf8');
    } catch (err) {
        console.error('❌ Could not read schema.sql:', err.message);
        throw err;
    }

    try {
        await pool.query(sql);
        console.log('✅ Database schema initialised (tables & seed data ready)');
    } catch (err) {
        console.error('❌ Failed to initialise database schema:', err.message);
        throw err;
    }
}

module.exports = initDb;
