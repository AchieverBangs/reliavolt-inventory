require('dotenv').config();
const app    = require('./src/app');
const pool   = require('./src/db/pool');
const initDb = require('./src/db/init');

const PORT = process.env.PORT || 4000;

async function start() {
    try {
        // Verify database connection
        await pool.query('SELECT 1');
        console.log('✅ PostgreSQL connected');

        // Initialise schema (idempotent — safe to run on every startup)
        await initDb();

        app.listen(PORT, () => {
            console.log(`🚀 Reliavolt API running on http://localhost:${PORT}`);
            console.log(`   Health: http://localhost:${PORT}/api/health`);
        });
    } catch (err) {
        console.error('❌ Startup failed:', err.message);
        console.error('   Make sure PostgreSQL is running and .env is configured correctly.');
        process.exit(1);
    }
}

start();
