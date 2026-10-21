const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('PostgreSQL expenditure persists, loads exact dates, and leaves original amounts unchanged',
    {skip: process.env.EXPENDITURE_DB_TEST !== '1'}, async () => {
    require('dotenv').config({path:path.join(__dirname,'../.env'),quiet:true});
    const {Client} = require('pg');
    const jwt = require('jsonwebtoken');
    const request = require('supertest');
    const pool = require('../src/db/pool');
    const app = require('../src/app');
    // This check only runs on a local database, with disposable temporary tables.
    const host=process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL).hostname : process.env.DB_HOST || 'localhost';
    assert.ok(['localhost','127.0.0.1','::1'].includes(host),'Integration test requires local PostgreSQL');
    const client=new Client(process.env.DATABASE_URL ? {connectionString:process.env.DATABASE_URL} : {
        host,port:Number(process.env.DB_PORT||5432),database:process.env.DB_NAME||'reliavolt_db',
        user:process.env.DB_USER||'postgres',password:process.env.DB_PASSWORD,connectionTimeoutMillis:3000
    });
    const original=pool.query;
    await client.connect();
    try {
        await client.query('BEGIN');
        await client.query('CREATE TEMP TABLE shops (id INTEGER PRIMARY KEY, name TEXT) ON COMMIT DROP');
        await client.query('CREATE TEMP TABLE users (id INTEGER PRIMARY KEY, name TEXT) ON COMMIT DROP');
        await client.query('CREATE TEMP TABLE sales (total NUMERIC(14,2), profit NUMERIC(14,2), commission NUMERIC(14,2)) ON COMMIT DROP');
        await client.query('CREATE TEMP TABLE products (quantity INTEGER, cost_price NUMERIC(14,2)) ON COMMIT DROP');
        await client.query("INSERT INTO shops VALUES (1, 'Main'), (2, 'Branch'); INSERT INTO users VALUES (1, 'Admin'); INSERT INTO sales VALUES (100,30,5); INSERT INTO products VALUES (10,7)");
        const schema=fs.readFileSync(path.join(__dirname,'../schema.sql'),'utf8');
        const ddl=schema.match(/CREATE TABLE IF NOT EXISTS expenditures \([\s\S]*?\n\);/)[0];
        await client.query(ddl.replace('CREATE TABLE IF NOT EXISTS expenditures','CREATE TEMP TABLE expenditures').replace(/\);$/,') ON COMMIT DROP;'));
        pool.query=(...args)=>client.query(...args);
        const authorization='Bearer '+jwt.sign({id:1,role:'Admin'},process.env.JWT_SECRET);
        const before=await client.query('SELECT total,profit,commission,quantity,cost_price FROM sales CROSS JOIN products');
        const res=await request(app).post('/api/expenditures').set('Authorization',authorization).send({expense_date:'2026-10-21',description:'Transport',category:'Travel',amount:'12.50',shop_id:1});
        assert.equal(res.status,201);
        assert.equal(res.body.expense_date,'2026-10-21');
        assert.equal(res.body.amount,'12.50');
        const loaded=await request(app).get('/api/expenditures').set('Authorization',authorization);
        assert.equal(loaded.status,200);
        assert.equal(loaded.body.length,1);
        assert.equal(loaded.body[0].id,res.body.id);
        assert.equal(loaded.body[0].expense_date,'2026-10-21');
        assert.equal(loaded.body[0].shop_name,'Main');
        const staff='Bearer '+jwt.sign({id:1,role:'Cashier',shopId:2},process.env.JWT_SECRET);
        assert.deepEqual((await request(app).get('/api/expenditures').set('Authorization',staff)).body,[]);
        const after=await client.query('SELECT total,profit,commission,quantity,cost_price FROM sales CROSS JOIN products');
        assert.deepEqual(after.rows,before.rows);
    } finally {
        pool.query=original;
        await client.query('ROLLBACK');
        await client.end();
    }
});
