const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const pool = require('../src/db/pool');
const app = require('../src/app');
process.env.JWT_SECRET = 'expenditure-test-secret';
const token = user => jwt.sign({ id: 1, role: 'Admin', ...user }, process.env.JWT_SECRET);
const valid = { expense_date: '2026-10-21', description: 'Transport', category: 'Travel', amount: '12.50', shop_id: 3 };

test('expenditures require authentication', async () => {
 assert.equal((await request(app).get('/api/expenditures')).status, 401);
});
test('rejects invalid amounts and dates without writing', async () => {
 for (const patch of [{amount: '-1'}, {amount: '0'}, {amount: '1.001'}, {expense_date: '2026-02-30'}, {description: ' '}]) {
  const res = await request(app).post('/api/expenditures').auth(token(), {type:'bearer'}).send({...valid,...patch});
  assert.equal(res.status,400);
 }
});
test('saving expenditure only inserts into its own table', async () => {
 const original = pool.query; const calls=[];
 pool.query = async (sql, values) => { calls.push({sql, values}); return { rows: [{id:1,...valid}] }; };
 try {
  const res=await request(app).post('/api/expenditures').auth(token(),{type:'bearer'}).send(valid);
  assert.equal(res.status,201); assert.equal(calls.length,1);
  assert.match(calls[0].sql,/^INSERT INTO expenditures /);
  assert.deepEqual(calls[0].values,['2026-10-21','Transport','Travel','12.50',3,1]);
 } finally { pool.query=original; }
});
test('staff can only read and record expenditures in their own shop', async () => {
 const original=pool.query; const calls=[];
 pool.query=async (sql,values) => {calls.push({sql,values}); return {rows: sql.startsWith('SELECT can_write') ? [{can_write:true}] : []};};
 try {
  const auth=token({role:'Cashier',shopId:7});
  assert.equal((await request(app).get('/api/expenditures').auth(auth,{type:'bearer'})).status,200);
  assert.match(calls[0].sql,/WHERE e.shop_id=\$1/); assert.deepEqual(calls[0].values,[7]);
  assert.equal((await request(app).post('/api/expenditures').auth(auth,{type:'bearer'}).send(valid)).status,201);
  assert.equal(calls.at(-1).values[4],7);
 } finally {pool.query=original;}
});
test('write-disabled users cannot record expenditure', async () => {
 const original=pool.query; pool.query=async()=>({rows:[{can_write:false}]});
 try {
  const res=await request(app).post('/api/expenditures').auth(token({role:'Cashier',shopId:7}),{type:'bearer'}).send(valid);
  assert.equal(res.status,403);
 } finally {pool.query=original;}
});
test('delivery role cannot access expenditure',async()=>{
 assert.equal((await request(app).get('/api/expenditures').auth(token({role:'Delivery Person'}),{type:'bearer'})).status,403);
});
