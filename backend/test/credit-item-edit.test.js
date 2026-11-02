const test=require('node:test');
const assert=require('node:assert/strict');
const request=require('supertest');
const jwt=require('jsonwebtoken');
const pool=require('../src/db/pool');
const app=require('../src/app');
process.env.JWT_SECRET='credit-item-edit-test';
const auth=role=>'Bearer '+jwt.sign({id:1,role,shopId:7},process.env.JWT_SECRET);
const save=(body,role='Admin')=>request(app).put('/api/customers/1/credit-items/10').set('Authorization',auth(role)).send(body);

test('editing credit items requires admin even if a staff member has sale-edit permission',async()=>{
    const original=pool.query,connect=pool.connect;
    pool.query=async()=>({rows:[{can_write:true,allowed:true}]});
    pool.connect=async()=>{throw new Error('Unauthorized role reached mutation');};
    try{
        assert.equal((await request(app).put('/api/customers/1/credit-items/10').send({qty:2,unit_price:'50'})).status,401);
        for(const role of ['Manager','Cashier','Stock Manager','Delivery Person'])assert.equal((await save({qty:2,unit_price:'50'},role)).status,403);
        for(const body of [{qty:0,unit_price:'1'},{qty:1.5,unit_price:'1'},{qty:1,unit_price:'-1'},{qty:1,unit_price:'1.001'},{qty:1,unit_price:'Infinity'},{qty:1,unit_price:'0'},{qty:2147483648,unit_price:'1'}])assert.equal((await save(body)).status,400);
    }finally{pool.query=original;pool.connect=connect;}
});

test('PostgreSQL credit item edits preserve repayments and correctly adjust balance, stock, profit and commission',
    {skip:process.env.CREDIT_EDIT_DB_TEST!=='1'},async()=>{
    require('dotenv').config({path:require('node:path').join(__dirname,'../.env')});
    const host=process.env.DATABASE_URL?new URL(process.env.DATABASE_URL).hostname:process.env.DB_HOST||'localhost';
    assert.ok(['localhost','127.0.0.1','::1'].includes(host),'Local PostgreSQL only');
    const {Client}=require('pg');
    const client=new Client(process.env.DATABASE_URL?{connectionString:process.env.DATABASE_URL}:{host,port:Number(process.env.DB_PORT||5432),database:process.env.DB_NAME||'reliavolt_db',user:process.env.DB_USER||'postgres',password:process.env.DB_PASSWORD,connectionTimeoutMillis:3000});
    await client.connect();
    const original=pool.query,connect=pool.connect;
    try{
        // All writes are isolated in connection-local temporary tables.
        await client.query(`CREATE TEMP TABLE customers (id INT PRIMARY KEY, credit_balance NUMERIC(14,2));
            CREATE TEMP TABLE products (id INT PRIMARY KEY, quantity INT);
            CREATE TEMP TABLE sales (id INT PRIMARY KEY,customer_id INT,product_id INT,qty INT,unit_price NUMERIC(14,2),unit_cost NUMERIC(14,2),
                total NUMERIC(14,2),profit NUMERIC(14,2),commission NUMERIC(14,2),credit_amount NUMERIC(14,2),credit_amount_paid NUMERIC(14,2),
                receipt_no TEXT,invoice_no TEXT,payment_method TEXT,commission_user_id INT,commission_date TIMESTAMP,
                earned_commission NUMERIC(14,2) GENERATED ALWAYS AS (commission*LEAST(1,(total-credit_amount+credit_amount_paid)/NULLIF(total,0))) STORED);
            CREATE TEMP TABLE stock_movements (product_id INT,type TEXT,qty_change INT,balance_after INT,note TEXT,user_id INT,sale_id INT);
            CREATE TEMP TABLE credit_payment_allocations (sale_id INT,amount NUMERIC);
            INSERT INTO customers VALUES (1,50);
            INSERT INTO products VALUES (5,8);
            INSERT INTO sales VALUES (10,1,5,2,50,20,100,60,10,80,30,'R-10','I-1','Credit',9,'2026-09-10');
            INSERT INTO credit_payment_allocations VALUES (10,30);`);
        pool.connect=async()=>({query:(...args)=>client.query(...args),release(){}});
        pool.query=async()=>({rows:[]}); // Audit writes are unrelated to the temporary business data.
        const snapshot=async()=>({sale:(await client.query('SELECT * FROM sales')).rows[0],
            customer:(await client.query('SELECT * FROM customers')).rows[0],product:(await client.query('SELECT * FROM products')).rows[0],
            allocations:(await client.query('SELECT * FROM credit_payment_allocations')).rows,
            movements:(await client.query('SELECT * FROM stock_movements')).rows});
        const before=await snapshot();
        for(const body of [{qty:1,unit_price:'40'},{qty:20,unit_price:'50'}]){
            assert.equal((await save(body)).status,400);
            assert.deepEqual(await snapshot(),before);
        }
        assert.equal((await request(app).put('/api/customers/1/credit-items/99').set('Authorization',auth('Admin')).send({qty:2,unit_price:'50'})).status,404);
        assert.equal((await save({qty:3,unit_price:'60'})).status,200);
        let state=await snapshot();
        assert.equal(state.product.quantity,7);
        assert.equal(state.customer.credit_balance,'130.00');
        assert.equal(state.sale.total,'180.00');
        assert.equal(state.sale.profit,'120.00');
        assert.equal(state.sale.commission,'15.00');
        assert.equal(state.sale.credit_amount,'160.00');
        assert.equal(state.sale.credit_amount_paid,'30.00');
        assert.equal(state.sale.receipt_no,'R-10');
        assert.equal(state.sale.invoice_no,'I-1');
        assert.equal(state.sale.commission_user_id,9);
        assert.deepEqual(state.sale.commission_date,before.sale.commission_date);
        assert.deepEqual(state.allocations,before.allocations);
        assert.equal(state.movements[0].qty_change,-1);
        // Lowering quantity restores stock; the deposit and repayments cover the new total exactly.
        assert.equal((await save({qty:1,unit_price:'50'})).status,200);
        state=await snapshot();
        assert.equal(state.product.quantity,9);
        assert.equal(state.customer.credit_balance,'0.00');
        assert.equal(state.sale.credit_amount,'30.00');
        assert.equal(state.sale.earned_commission,'5.00');
        assert.equal(state.movements[1].qty_change,2);
        // A price-only correction to a fully paid item can create a new outstanding balance.
        assert.equal((await save({qty:1,unit_price:'60'})).status,200);
        state=await snapshot();
        assert.equal(state.customer.credit_balance,'10.00');
        assert.equal(state.product.quantity,9);
        assert.equal(state.movements.length,2);
        assert.deepEqual(state.allocations,before.allocations);
    }finally{pool.query=original;pool.connect=connect;await client.end();}
});
