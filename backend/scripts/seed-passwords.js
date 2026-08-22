/**
 * Sets a fresh, randomly-generated bcrypt password for every active user.
 * Run once after schema.sql, or any time you need to rotate all passwords:
 *   node scripts/seed-passwords.js
 *
 * Passwords are printed ONCE to the console — write them down / send them to
 * each user securely, then close the terminal. Nothing is stored in the repo.
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const pool   = require('../src/db/pool');

function generatePassword() {
    // 12 random chars from an unambiguous alphabet (no 0/O/1/l/I)
    const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
    return Array.from(crypto.randomFillSync(new Uint8Array(12)))
        .map(b => alphabet[b % alphabet.length])
        .join('');
}

async function run() {
    const { rows: users } = await pool.query(
        "SELECT id, username, name FROM users WHERE status = 'Active' ORDER BY username"
    );

    if (!users.length) {
        console.log('No active users found.');
        process.exit(0);
    }

    console.log('Rotating passwords for all active users...\n');
    const results = [];
    for (const u of users) {
        const password = generatePassword();
        const hash = await bcrypt.hash(password, 10);
        await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, u.id]);
        results.push({ username: u.username, name: u.name, password });
    }

    console.log('username'.padEnd(12), 'name'.padEnd(20), 'new password');
    console.log('-'.repeat(50));
    results.forEach(r => console.log(r.username.padEnd(12), r.name.padEnd(20), r.password));

    console.log('\nRecord these now — they will not be shown again. Done.');
    process.exit(0);
}

run().catch(err => { console.error(err); process.exit(1); });
