const fs   = require('fs');
const path = require('path');
const pool = require('./pool');

async function initDb() {
    const schemaPath = path.join(__dirname, '..', '..', 'schema.sql');
    const sql = fs.readFileSync(schemaPath, 'utf8');
    await pool.query(sql);
    console.log('✅ Database schema initialised');
}

module.exports = { initDb };
