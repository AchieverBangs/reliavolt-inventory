const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../../Reliavolt-Inventory-Frontend/js/invoice.js'), 'utf8');
const context = { localStorage: { getItem: () => null } };
vm.runInNewContext(source, context);

test('receipt displays saved reference, escaped customer details and exact money', () => {
    const html = context.renderInvoiceHtml({invoiceNo:'RVS-0000000123', customerName:'<script>', paymentMethod:'Cash',
        lines:[{qty:2,description:'Cable & plug',unitPrice:12.5,amount:25}]});
    assert.match(html, /SALES RECEIPT/);
    assert.match(html, /RVS-0000000123/);
    assert.match(html, /25\.00/);
    assert.match(html, /PAID IN FULL/);
    assert.match(html, /&lt;script&gt;/);
    assert.match(html, /Cable &amp; plug/);
    assert.doesNotMatch(html, /inv-blank/);
});

test('unsaved sale is visibly a draft without an issued receipt number', () => {
    const html = context.renderInvoiceHtml({invoiceNo:'—', lines:[]});
    assert.match(html, /SALE PREVIEW/);
    assert.match(html, /Assigned after sale is saved/);
    assert.match(html, /DRAFT/);
});

test('credit receipt reprint reflects subsequent repayments', () => {
    const data = context.invoiceDataFromLines({invoice_no:'RVS-1',lines:[{qty:1,total:'100',unit_price:'100',
        payment_method:'Credit',credit_amount:'80',credit_amount_paid:'30'}]}, {});
    assert.equal(data.amountPaid, 50);
    assert.match(context.renderInvoiceHtml(data), /PART PAYMENT/);
    const settled = context.invoiceDataFromLines({invoice_no:'RVS-1',lines:[{qty:1,total:'100',
        payment_method:'Credit',credit_amount:'80',credit_amount_paid:'80'}]}, {});
    assert.match(context.renderInvoiceHtml(settled), /PAID IN FULL/);
});

test('database rejects duplicate, reused and changed receipt numbers', {skip:process.env.RECEIPT_DB_TEST !== '1'}, async () => {
    require('dotenv').config({path:path.join(__dirname,'../.env')});
    const {Client} = require('pg');
    const host = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL).hostname : process.env.DB_HOST || 'localhost';
    assert.ok(['localhost','127.0.0.1','::1'].includes(host), 'Requires local PostgreSQL');
    const client = new Client(process.env.DATABASE_URL ? {connectionString:process.env.DATABASE_URL} : {
        host,port:Number(process.env.DB_PORT||5432),database:process.env.DB_NAME||'reliavolt_db',
        user:process.env.DB_USER||'postgres',password:process.env.DB_PASSWORD,connectionTimeoutMillis:5000
    });
    await client.connect();
    try {
        await client.query('BEGIN');
        await client.query('CREATE SCHEMA receipt_test_isolated');
        await client.query('SET LOCAL search_path TO receipt_test_isolated');
        await client.query('CREATE TABLE sales (receipt_no VARCHAR(50) UNIQUE NOT NULL, invoice_no VARCHAR(50))');
        await client.query("INSERT INTO sales VALUES ('RV-OLD','RV-OLD')");
        const schema = fs.readFileSync(path.join(__dirname,'../schema.sql'),'utf8');
        const migration = schema.slice(schema.indexOf('-- Permanent register:'), schema.indexOf('-- Each payment a customer'));
        await client.query(migration);
        await client.query(migration); // startup can safely apply it again
        await client.query("INSERT INTO sales VALUES ('RVS-0000000001','RVS-0000000001')");
        async function rejected(sql, code) {
            await client.query('SAVEPOINT receipt_check');
            await assert.rejects(client.query(sql), e => e.code === code);
            await client.query('ROLLBACK TO SAVEPOINT receipt_check');
        }
        await rejected("INSERT INTO sales VALUES ('RVS-0000000001','RVS-0000000001')", '23505');
        await rejected("UPDATE sales SET receipt_no='CHANGED' WHERE receipt_no='RV-OLD'", 'P0001');
        await rejected("UPDATE sales SET invoice_no='CHANGED' WHERE receipt_no='RV-OLD'", 'P0001');
        await client.query("DELETE FROM sales WHERE receipt_no='RV-OLD'");
        await rejected("INSERT INTO sales VALUES ('RV-OLD','RV-OLD')", '23505');
    } finally {
        await client.query('ROLLBACK');
        await client.end();
    }
});
