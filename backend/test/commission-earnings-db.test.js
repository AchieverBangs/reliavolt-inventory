const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { commissionEarnings } = require('../src/services/commissionEarnings');
const { periodExpr } = require('../src/services/commissionPeriod');

test('repayments earn commission in their own periods, retroactively and without duplication',
    { skip: process.env.COMMISSION_DB_TEST !== '1' }, async () => {
    require('dotenv').config({ path: path.join(__dirname, '../.env') });
    const { Client } = require('pg');
    const host = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL).hostname : process.env.DB_HOST || 'localhost';
    assert.ok(['localhost', '127.0.0.1', '::1'].includes(host), 'Use local PostgreSQL only');
    const client = new Client(process.env.DATABASE_URL ? { connectionString: process.env.DATABASE_URL } : {
        host, port: Number(process.env.DB_PORT || 5432), database: process.env.DB_NAME || 'reliavolt_db',
        user: process.env.DB_USER || 'postgres', password: process.env.DB_PASSWORD, connectionTimeoutMillis: 3000
    });
    await client.connect();
    try {
        await client.query('BEGIN');
        await client.query(`CREATE TEMP TABLE sales (
            id INT, commission_user_id INT, commission_date TIMESTAMP,
            total NUMERIC, credit_amount NUMERIC, credit_amount_paid NUMERIC, commission NUMERIC,
            earned_commission NUMERIC(14,2) GENERATED ALWAYS AS
              (commission * LEAST(1, (total-credit_amount+credit_amount_paid)/NULLIF(total,0))) STORED
        );
        CREATE TEMP TABLE credit_payments (id INT, paid_at TIMESTAMP);
        CREATE TEMP TABLE credit_payment_allocations (id INT, sale_id INT, payment_id INT, amount NUMERIC);
        INSERT INTO sales VALUES (1,7,'2026-08-10',100,80,60,10), (2,8,'2026-09-02',3,3,3,1),
          (3,7,'2026-10-20',100,0,0,10);
        INSERT INTO credit_payments VALUES (1,'2026-09-20'),(2,'2026-10-20'),
          (3,'2026-09-10'),(4,'2026-10-14'),(5,'2026-10-15');
        INSERT INTO credit_payment_allocations VALUES (1,1,1,20),(2,1,2,40),
          (3,2,3,1),(4,2,4,1),(5,2,5,1);`);
        const earnings = () => client.query(`SELECT id, EXTRACT(MONTH FROM ${periodExpr('commission_date')})::int AS month,
            SUM(earned_commission)::text AS total FROM ${commissionEarnings} e GROUP BY 1,2 ORDER BY 1,2`);
        assert.deepEqual((await earnings()).rows, [
            {id:1,month:8,total:'2.00'}, {id:1,month:9,total:'2.00'}, {id:1,month:10,total:'4.00'},
            {id:2,month:9,total:'0.67'}, {id:2,month:10,total:'0.33'}, {id:3,month:10,total:'10.00'}
        ]);
        const totals = await client.query(`SELECT e.commission_user_id, SUM(e.earned_commission)::text AS total
            FROM ${commissionEarnings} e GROUP BY 1 ORDER BY 1`);
        assert.deepEqual(totals.rows,[{commission_user_id:7,total:'18.00'},{commission_user_id:8,total:'1.00'}]);
        await client.query(`CREATE TEMP TABLE users (id INT PRIMARY KEY, name TEXT, username TEXT, role TEXT);
            INSERT INTO users VALUES (7,'Seller','seller','Cashier'),(8,'Other','other','Cashier');
            CREATE TEMP TABLE commission_settlements (id INT, user_id INT, year INT, month INT,
                total_commission NUMERIC, staff_confirmed_at TIMESTAMP, admin_confirmed_at TIMESTAMP);`);
        const pool = require('../src/db/pool');
        const originalQuery = pool.query;
        const request = require('supertest');
        const jwt = require('jsonwebtoken');
        process.env.JWT_SECRET = 'commission-regression-test';
        const app = require('../src/app');
        pool.query = (...args) => client.query(...args);
        const auth = role => 'Bearer ' + jwt.sign({id:7,role,shopId:1},process.env.JWT_SECRET);
        try {
            for (const [month,total] of [[9,'2.00'],[10,'14.00']]) {
                const response = await request(app).get(`/api/sales/commission/summary?year=2026&month=${month}`)
                    .set('Authorization',auth('Cashier'));
                assert.equal(response.status,200);
                assert.equal(response.body.mine.selected,total);
                assert.equal(response.body.byStaff,undefined);
            }
            const admin = await request(app).get('/api/sales/commission/summary?year=2026&month=9')
                .set('Authorization',auth('Admin'));
            assert.equal(admin.status,200);
            assert.deepEqual(admin.body.byStaff.map(s=>[s.user_id,s.selected]),[[8,'0.67'],[7,'2.00']]);
            assert.equal((await request(app).get('/api/commission/pending-admin')
                .set('Authorization',auth('Cashier'))).status,403);
            assert.equal((await request(app).get('/api/sales/commission/summary')
                .set('Authorization',auth('Stock Manager'))).status,403);
        } finally { pool.query = originalQuery; }
        // Reversing a repayment removes its slice and reduces the lifetime total.
        await client.query(`DELETE FROM credit_payment_allocations WHERE payment_id=2;
            DELETE FROM credit_payments WHERE id=2; UPDATE sales SET credit_amount_paid=20 WHERE id=1;`);
        assert.deepEqual((await earnings()).rows.filter(r=>r.id===1),[
            {id:1,month:8,total:'2.00'},{id:1,month:9,total:'2.00'}
        ]);
    } finally {
        await client.query('ROLLBACK');
        await client.end();
    }
});
