const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const pool = require('../src/db/pool');
const app = require('../src/app');
process.env.JWT_SECRET = 'credit-history-test';
const auth = (role='Cashier', shopId=7) => 'Bearer '+jwt.sign({id:2,role,shopId},process.env.JWT_SECRET);

test('past credit includes settled accounts and keeps staff and admin shop filters', async () => {
    const original = pool.query;
    const calls=[];
    pool.query=async(sql,values)=>{calls.push({sql,values});return {rows:[{id:1,name:'Paid customer',credit_balance:'0.00'}]};};
    try {
        assert.equal((await request(app).get('/api/customers/credit?history=1')).status,401);
        const result=await request(app).get('/api/customers/credit?history=1&shop_id=99').set('Authorization',auth());
        assert.equal(result.status,200);
        assert.equal(result.body[0].credit_balance,'0.00');
        assert.match(calls.at(-1).sql,/EXISTS \(SELECT 1 FROM sales/);
        assert.match(calls.at(-1).sql,/EXISTS \(SELECT 1 FROM credit_payments/);
        assert.match(calls.at(-1).sql,/\) AND c.shop_id = \$1/);
        assert.deepEqual(calls.at(-1).values,[7]);
        await request(app).get('/api/customers/credit?history=1&shop_id=99').set('Authorization',auth('Admin'));
        assert.deepEqual(calls.at(-1).values,['99']);
        await request(app).get('/api/customers/credit').set('Authorization',auth());
        assert.doesNotMatch(calls.at(-1).sql,/EXISTS/);
        const count=calls.length;
        assert.deepEqual((await request(app).get('/api/customers/credit?history=1').set('Authorization',auth('Cashier',null))).body,[]);
        assert.equal(calls.length,count);
    } finally {pool.query=original;}
});

test('fully paid customers retain the complete timeline and other shops cannot read it', async () => {
    const original=pool.query;
    const calls=[];
    pool.query=async(sql,values)=>{
        calls.push(sql);
        assert.deepEqual(values,['1']);
        if(sql.includes('FROM customers'))return {rows:[{id:1,name:'Paid customer',shop_id:7,credit_balance:'0.00'}]};
        if(sql.includes('FROM sales'))return {rows:[{type:'sale',amount:'100',at:'2026-09-01'}]};
        return {rows:[{type:'payment',amount:'40',at:'2026-09-20'},{type:'payment',amount:'60',at:'2026-10-20'}]};
    };
    try {
        const response=await request(app).get('/api/customers/1/credit-history').set('Authorization',auth());
        assert.equal(response.status,200);
        assert.equal(response.body.customer.credit_balance,'0.00');
        assert.deepEqual(response.body.timeline.map(e=>e.type),['sale','payment','payment']);
        assert.doesNotMatch(calls[1],/credit_amount_paid\s*[<>=]/);
        calls.length=0;
        assert.equal((await request(app).get('/api/customers/1/credit-history').set('Authorization',auth('Cashier',8))).status,404);
        assert.equal(calls.length,1);
    } finally {pool.query=original;}
});
