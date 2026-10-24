const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const pool = require('../src/db/pool');
const app = require('../src/app');
process.env.JWT_SECRET = 'deposit-test-secret';
const token = (role = 'Admin') => jwt.sign({ id: 2, role, shopId: 7 }, process.env.JWT_SECRET);
function save(patch = {}, role = 'Admin', receipt = Buffer.from('%PDF-test')) {
    let req = request(app).post('/api/deposits').auth(token(role), { type: 'bearer' });
    for (const [key, value] of Object.entries({ amount: '15.20', receipt_number: 'BANK-1', deposit_date: '2026-01-01', shop_id: '3', ...patch })) req = req.field(key, value);
    return req.attach('receipt', receipt, { filename: 'receipt.pdf', contentType: 'application/pdf' });
}
test('authentication and manager role are required', async () => {
    assert.equal((await request(app).get('/api/deposits')).status, 401);
    assert.equal((await request(app).get('/api/deposits').auth(token('Cashier'), {type:'bearer'})).status,403);
});
test('invalid money, dates and receipt contents cannot be saved', async () => {
    for (const patch of [{amount:'0'}, {amount:'1.001'}, {deposit_date:'2026-02-30'}, {deposit_date:'2999-01-01'}, {receipt_number:' '}]) assert.equal((await save(patch)).status,400);
    assert.equal((await save({}, 'Admin', Buffer.from('invalid'))).status,400);
    assert.equal((await save({}, 'Admin', Buffer.alloc(5*1024*1024+1))).status,400);
});
test('backdated deposits use authenticated manager and assigned shop, with server timestamp', async () => {
    const original=pool.query, calls=[];
    pool.query=async(sql,values)=>{calls.push({sql,values});return {rows:sql.startsWith('SELECT can_write')?[{can_write:true}]:[{id:1}]};};
    try {
        assert.equal((await save({},'Manager')).status,201);
        const insert=calls.at(-1); assert.equal(insert.values[2],'2026-01-01');
        assert.equal(insert.values[3],7);assert.equal(insert.values[4],2);
        assert.match(insert.sql,/INSERT INTO deposits/);
        assert.doesNotMatch(insert.sql,/created_at\)/);
        await request(app).get('/api/deposits').auth(token('Manager'),{type:'bearer'});
        assert.deepEqual(calls.at(-1).values,[7]);
        await request(app).get('/api/deposits/9/receipt').auth(token('Manager'),{type:'bearer'});
        assert.deepEqual(calls.at(-1).values,[7,'9']);
    } finally {pool.query=original;}
});
test('receipt downloads enforce scope and return the stored bytes', async () => {
    const original=pool.query;
    const bytes=Buffer.from('%PDF-stored-receipt');
    try {
        pool.query=async(sql,values)=>{
            assert.deepEqual(values,[7,'9']);
            assert.match(sql,/d.shop_id=\$1/);
            return {rows:[{receipt_type:'application/pdf',receipt_data:bytes}]};
        };
        const response=await request(app).get('/api/deposits/9/receipt').auth(token('Manager'),{type:'bearer'});
        assert.equal(response.status,200);assert.deepEqual(response.body,bytes);
        assert.match(response.headers['content-disposition'],/attachment/);
        pool.query=async()=>({rows:[]});
        assert.equal((await request(app).get('/api/deposits/9/receipt').auth(token('Manager'),{type:'bearer'})).status,404);
    } finally {pool.query=original;}
});
test('duplicate receipts return conflict and write-disabled managers cannot save', async () => {
    const original=pool.query;
    try {
        pool.query=async()=>{throw Object.assign(new Error('duplicate'),{code:'23505'});};
        assert.equal((await save()).status,409);
        pool.query=async()=>({rows:[{can_write:false}]});
        assert.equal((await save({},'Manager')).status,403);
    } finally {pool.query=original;}
});

test('editing preserves receipt and submission details and enforces shop scope', async()=>{
 const original=pool.query;const calls=[];
 pool.query=async(sql,values)=>{calls.push({sql,values});return {rows:sql.startsWith('SELECT can_write')?[{can_write:true}]:[{id:9,amount:'25.00'}]};};
 try {
  const response=await request(app).put('/api/deposits/9').auth(token('Manager'),{type:'bearer'}).field('amount','25.00').field('receipt_number','CORRECTED').field('deposit_date','2026-01-01').field('shop_id','999');
  assert.equal(response.status,200);const update=calls.at(-1);
  assert.deepEqual(update.values,['25.00','CORRECTED','2026-01-01',7,'9',7]);
  assert.match(update.sql,/WHERE id=\$5 AND shop_id=\$6/);
  assert.doesNotMatch(update.sql,/SET[^]*receipt_data=/);
  assert.doesNotMatch(update.sql,/created_at=|created_by=/);
 }finally{pool.query=original;}
});
test('edit accepts replacement receipt and rejects unauthorized or missing deposits',async()=>{
 const original=pool.query;let calls=[];
 pool.query=async(sql,values)=>{calls.push({sql,values});return {rows:[{id:9}]};};
 try{
  const response=await request(app).put('/api/deposits/9').auth(token(),{type:'bearer'}).field('amount','25').field('receipt_number','NEW').field('deposit_date','2026-01-01').field('shop_id','3').attach('receipt',Buffer.from('%PDF-replaced'),{filename:'new.pdf',contentType:'application/pdf'});
  assert.equal(response.status,200);assert.match(calls.at(-1).sql,/receipt_data=\$7/);assert.deepEqual(calls.at(-1).values[6],Buffer.from('%PDF-replaced'));
  pool.query=async()=>({rows:[]});
  assert.equal((await request(app).put('/api/deposits/9').auth(token(),{type:'bearer'}).field('amount','25').field('receipt_number','NEW').field('deposit_date','2026-01-01').field('shop_id','3')).status,404);
  pool.query=async()=>({rows:[{can_write:false}]});
  assert.equal((await request(app).put('/api/deposits/9').auth(token('Manager'),{type:'bearer'})).status,403);
 }finally{pool.query=original;}
});
