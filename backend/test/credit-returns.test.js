const test=require('node:test');
const assert=require('node:assert/strict');
const request=require('supertest');
const jwt=require('jsonwebtoken');
const fs=require('node:fs');
const path=require('node:path');
const pool=require('../src/db/pool');
const app=require('../src/app');
process.env.JWT_SECRET='credit-returns-test';
const token=role=>'Bearer '+jwt.sign({id:1,role},process.env.JWT_SECRET);
const url='/api/customers/1/credit-returns/1';
test('credit returns require an admin and a positive integer quantity',async()=>{
 assert.equal((await request(app).post(url).send({qty:2})).status,401);
 // GET-role tokens cannot bypass the write gate or route role restriction.
 const original=pool.query;
 pool.query=async()=>({rows:[{can_write:true}]});
 try {
 for(const role of ['Manager','Cashier','Stock Manager','Delivery']) assert.equal((await request(app).post(url).set('Authorization',token(role)).send({qty:2})).status,403);
 for(const qty of [0,-1,1.5,'2',null]) assert.equal((await request(app).post(url).set('Authorization',token('Admin')).send({qty})).status,400);
 } finally {pool.query=original;}
});
test('credit returns restore original stock and totals atomically', {skip:process.env.RECEIPT_DB_TEST!=='1'},async()=>{
 const {Client}=require('pg');
 assert.ok(['localhost','127.0.0.1'].includes(process.env.DB_HOST||'localhost'));
 const client=new Client({host:process.env.DB_HOST||'localhost',port:Number(process.env.DB_PORT||5432),database:process.env.DB_NAME||'reliavolt_db',user:process.env.DB_USER||'postgres',password:process.env.DB_PASSWORD});
 await client.connect();
 const schema='credit_return_test_'+process.pid;
 const original=pool.connect;
 try {
 await client.query(`CREATE SCHEMA ${schema}`);
 await client.query(`SET search_path TO ${schema}`);
 await client.query(fs.readFileSync(path.join(__dirname,'../schema.sql'),'utf8'));
 await client.query("INSERT INTO customers(id,name,shop_id,credit_balance) VALUES(9000,'Return test',1,300)");
 await client.query("INSERT INTO products(id,name,shop_id,quantity,cost_price,selling_price) VALUES(9000,'5W colored bulb',1,7,60,100)");
 await client.query("INSERT INTO sales(id,receipt_no,product_id,product_name,customer_id,qty,unit_price,unit_cost,total,profit,commission,payment_method,shop_id,credit_amount) VALUES(9000,'TEST-RETURN',9000,'5W colored bulb',9000,3,100,60,300,120,30,'Credit',1,300)");
 client.release=()=>{};pool.connect=async()=>client;
 const endpoint='/api/customers/9000/credit-returns/9000';
 const post=qty=>request(app).post(endpoint).set('Authorization',token('Admin')).send({qty});
 assert.equal((await post(4)).status,400);
 assert.equal((await request(app).post(endpoint).set('Authorization',token('Admin')).send({qty:1,expected_qty:2})).status,409);
 const returned=await post(2);assert.equal(returned.status,200);assert.equal(returned.body.amount,'200.00');
 const snapshot=async()=> (await client.query('SELECT p.quantity,s.qty,s.total,s.profit,s.commission,s.credit_amount,c.credit_balance FROM products p JOIN sales s ON s.product_id=p.id JOIN customers c ON c.id=s.customer_id WHERE s.id=9000')).rows[0];
 assert.deepEqual(await snapshot(),{quantity:9,qty:1,total:'100.00',profit:'40.00',commission:'10.00',credit_amount:'100.00',credit_balance:'100.00'});
 assert.equal((await client.query("SELECT qty_change FROM stock_movements WHERE sale_id=9000 AND type='adjustment'")).rows[0].qty_change,2);
 assert.equal((await client.query("SELECT count(*) FROM activity_log WHERE entity_id=9000")).rows[0].count,'1');
 // Reject refunding already-paid goods, without changing quantities.
 await client.query('UPDATE sales SET credit_amount_paid=50 WHERE id=9000');
 assert.equal((await post(1)).status,400);assert.equal((await snapshot()).quantity,9);
 await client.query('UPDATE sales SET credit_amount_paid=0 WHERE id=9000');
 // A failed stock audit must roll back every stock and money update.
 const query=client.query.bind(client);
 client.query=(sql,...args)=>String(sql).includes('INSERT INTO stock_movements')?Promise.reject(new Error('Simulated return audit failure')):query(sql,...args);
 assert.equal((await post(1)).status,500);client.query=query;
 assert.equal((await snapshot()).quantity,9);assert.equal((await snapshot()).credit_balance,'100.00');
 assert.equal((await post(1)).status,200);
 assert.equal((await snapshot()).quantity,10);assert.equal((await snapshot()).credit_balance,'0.00');
 assert.equal((await post(1)).status,400);
 } finally {
 pool.connect=original;
 await client.query('ROLLBACK');await client.query('SET search_path TO public');await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await client.end();
 }
});

test('return UI confirms original-price reduction and refreshes credit after saving',async()=>{
 const vm=require('node:vm');const calls=[];let confirm;
 const context={document:{addEventListener:()=>{}},isAdmin:()=>true,window:{prompt:()=> '2'},formatCurrency:n=>String(n),showToast:()=>{},showConfirm:(title,message,callback)=>{confirm={message,callback};},api:{post:async(...args)=>calls.push(args)}};
 vm.createContext(context);
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../../credit.js'),'utf8'),context);
 vm.runInContext(`_activeHistoryCustomerId=9; _activeHistoryData={timeline:[{type:'sale',id:7,qty:3,unit_price:'100.00',unpaid_amount:'300.00',product_name:'5W bulb'}]}; reloadCreditCustomers=async()=>{}; openCreditHistory=async()=>{}; returnCreditGoods(7)`,context);
 assert.match(confirm.message,/200/);await confirm.callback();
 assert.equal(calls[0][0],'/api/customers/9/credit-returns/7');
 assert.equal(calls[0][1].qty,2);assert.equal(calls[0][1].expected_qty,3);
 confirm=null;context.window.prompt=()=> '4';vm.runInContext('returnCreditGoods(7)',context);assert.equal(confirm,null);
 context.isAdmin=()=>false;context.window.prompt=()=>{throw Error('Staff must not see return prompt')};vm.runInContext('returnCreditGoods(7)',context);
});
