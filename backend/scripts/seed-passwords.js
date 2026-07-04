/**
 * Sets real bcrypt password hashes for the seeded sample users.
 * Run once after schema.sql:  node scripts/seed-passwords.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const bcrypt = require('bcryptjs');
const pool   = require('../src/db/pool');

const USERS = [
    { username: 'admin',   password: 'admin123'  },
    { username: 'amadu',   password: 'staff123'  },
    { username: 'fatima',  password: 'staff123'  },
    { username: 'ibrahim', password: 'staff123'  },
    { username: 'mariama', password: 'staff123'  },
    { username: 'sorie',   password: 'driver123' },
    { username: 'foday',   password: 'driver123' },
];

async function run() {
    console.log('Setting passwords for sample users...');
    for (const u of USERS) {
        const hash = await bcrypt.hash(u.password, 10);
        const { rowCount } = await pool.query(
            'UPDATE users SET password_hash = $1 WHERE username = $2',
            [hash, u.username]
        );
        console.log(`  ${u.username}: ${rowCount ? '✅' : '⚠️  not found'}`);
    }
    console.log('Done.');
    process.exit(0);
}

run().catch(err => { console.error(err); process.exit(1); });
