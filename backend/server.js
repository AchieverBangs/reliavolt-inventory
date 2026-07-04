require('dotenv').config();
const fs   = require('fs');
const path = require('path');
const app  = require('./src/app');
const pool = require('./src/db/pool');

const PORT = process.env.PORT || 4000;

async function start() {
    try {
        await pool.query('SELECT 1');
        console.log('✅ PostgreSQL connected');

        // Run schema (CREATE IF NOT EXISTS + seed ON CONFLICT DO NOTHING — safe to re-run)
        const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
        await pool.query(schema);
        console.log('✅ Schema initialised');

        app.listen(PORT, () => {
            console.log(`🚀 Reliavolt API running on http://localhost:${PORT}`);
            console.log(`   Health: http://localhost:${PORT}/api/health`);
        });
    } catch (err) {
        console.error('❌ Startup error:', err.message);
        process.exit(1);
    }
}

start();
