require('dotenv').config();
const app  = require('./src/app');
const pool = require('./src/db/pool');

const PORT = process.env.PORT || 4000;

async function start() {
    try {
        // Verify database connection
        await pool.query('SELECT 1');
        console.log('✅ PostgreSQL connected');

        app.listen(PORT, () => {
            console.log(`🚀 Reliavolt API running on http://localhost:${PORT}`);
            console.log(`   Health: http://localhost:${PORT}/api/health`);
        });
    } catch (err) {
        console.error('❌ Failed to connect to PostgreSQL:', err.message);
        console.error('   Make sure PostgreSQL is running and .env is configured correctly.');
        process.exit(1);
    }
}

start();
