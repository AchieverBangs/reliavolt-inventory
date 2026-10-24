const test=require('node:test');
const assert=require('node:assert/strict');
const request=require('supertest');
const jwt=require('jsonwebtoken');
const pool=require('../src/db/pool');
const app=require('../src/app');
process.env.JWT_SECRET='pre-inventory-tests';
const auth=(role='Admin')=>jwt.sign({id:1,role,shopId:3},process.env.JWT_SECRET);
const goods={name:'Solar panel',category:'Solar',brand:'Brand',reference:'CHINA-1',cost_price:'120.50',selling_price:'200.00',commission:'5.25',commission_user_id:2,quantity:10,allocations:[{shop_id:3,quantity:4},{shop_id:7,quantity:6}]};
async function database(handler,run){
    const original=pool.connect,calls=[];
    pool.connect=async()=>({query:async(sql,values)=>{calls.push({sql,values});return handler(sql,values);},release:()=>calls.push({sql:'RELEASE'})});
    try{await run(calls);}finally{pool.connect=original;}
}
test('purchase costs and cross-shop allocations require admin authentication',async()=>{
    assert.equal((await request(app).get('/api/pre-inventory')).status,401);
    assert.equal((await request(app).get('/api/pre-inventory').auth(auth('Manager'),{type:'bearer'})).status,403);
});
test('every non-admin role is denied pre-inventory commission read, create, edit and transfer',async()=>{
    const original=pool.query;
    pool.query=async()=>({rows:[{can_write:true}]});
    try{
        for(const role of ['Manager','Cashier','Stock Manager','Delivery Person']){
            for(const [method,url] of [['get','/api/pre-inventory'],['post','/api/pre-inventory'],['put','/api/pre-inventory/1'],['post','/api/pre-inventory/1/receive']]){
                const response=await request(app)[method](url).auth(auth(role),{type:'bearer'}).send(goods);
                assert.equal(response.status,403,role+' '+method+' '+url);
            }
        }
    }finally{pool.query=original;}
});
test('rejects mismatched allocations, duplicate shops, fractional quantities and invalid prices',async()=>{
    for(const patch of [{quantity:11},{quantity:1.5},{cost_price:'-1'},{selling_price:'2.001'},{allocations:[{shop_id:3,quantity:4},{shop_id:3,quantity:6}]},{name:' '},{commission:'-1'},{commission:'1.001'},{commission_user_id:'2'},{commission_user_id:-1}]){
        assert.equal((await request(app).post('/api/pre-inventory').auth(auth(),{type:'bearer'}).send({...goods,...patch})).status,400);
    }
});
test('saving goods only creates pre-inventory and allocations, without saleable stock',async()=>{
    await database(sql=>({rows:sql.startsWith('INSERT INTO pre_inventory ')?[{id:8,...goods}]:[]}),async calls=>{
        assert.equal((await request(app).post('/api/pre-inventory').auth(auth(),{type:'bearer'}).send(goods)).status,201);
        assert.equal(calls.filter(c=>c.sql.startsWith('INSERT INTO pre_inventory_allocations')).length,2);
        assert.deepEqual(calls.find(c=>c.sql.startsWith('INSERT INTO pre_inventory ')).values.slice(8),['5.25',2]);
        assert.ok(!calls.some(c=>/INSERT INTO (products|stock_movements)/.test(c.sql)));
        assert.ok(calls.some(c=>c.sql==='COMMIT'));
    });
});
test('arrival transfers exact allocated quantities and prices with stock history in one transaction',async()=>{
    let productId=100;
    await database(sql=>({rows:sql.startsWith('SELECT * FROM pre_inventory WHERE')?[{id:8,...goods}]:sql.startsWith('SELECT * FROM pre_inventory_allocations')?[{id:1,shop_id:3,quantity:4},{id:2,shop_id:7,quantity:6}]:sql.includes('INSERT INTO products')?[{id:productId++}]:[]}),async calls=>{
        assert.equal((await request(app).post('/api/pre-inventory/8/receive').auth(auth(),{type:'bearer'}).send({})).status,200);
        assert.match(calls[1].sql,/FOR UPDATE/);
        const products=calls.filter(c=>c.sql.includes('INSERT INTO products'));
        assert.deepEqual(products.map(c=>[c.values[3],c.values[4],c.values[5],c.values[6]]),[['120.50','200.00',4,3],['120.50','200.00',6,7]]);
        assert.equal(calls.filter(c=>c.sql.includes('INSERT INTO stock_movements')).length,2);
        assert.deepEqual(products.map(c=>c.values.slice(8)),[['5.25',2],['5.25',2]]);
        assert.ok(calls.some(c=>c.sql.startsWith('UPDATE pre_inventory SET received_at')));
        assert.equal(calls.at(-2).sql,'COMMIT');
    });
});
test('repeated transfer and editing received goods are rejected without adding stock',async()=>{
    await database(()=>({rows:[{id:8,received_at:'2026-01-01'}]}),async calls=>{
        assert.equal((await request(app).post('/api/pre-inventory/8/receive').auth(auth(),{type:'bearer'}).send({})).status,409);
        assert.equal((await request(app).put('/api/pre-inventory/8').auth(auth(),{type:'bearer'}).send(goods)).status,409);
        assert.ok(!calls.some(c=>c.sql.includes('INSERT INTO products')));
    });
});
test('a failed shop insert rolls back the entire transfer',async()=>{
    await database(sql=>{
        if(sql.startsWith('SELECT * FROM pre_inventory WHERE'))return {rows:[{id:8,...goods}]};
        if(sql.startsWith('SELECT * FROM pre_inventory_allocations'))return {rows:[{id:1,shop_id:3,quantity:4},{id:2,shop_id:7,quantity:6}]};
        if(sql.includes('INSERT INTO products'))throw new Error('Simulated storage failure');
        return {rows:[]};
    },async calls=>{
        assert.equal((await request(app).post('/api/pre-inventory/8/receive').auth(auth(),{type:'bearer'}).send({})).status,500);
        assert.ok(calls.some(c=>c.sql==='ROLLBACK'));assert.ok(!calls.some(c=>c.sql==='COMMIT'));
    });
});
