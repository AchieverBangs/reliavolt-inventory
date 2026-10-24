const test=require('node:test');
const assert=require('node:assert/strict');
const pool=require('../src/db/pool');
const knowledge=require('../src/services/aiKnowledge');
const admin={role:'Admin'};
const definitions=[
 ['deposits','id','integer'],['deposits','amount','numeric'],['deposits','shop_id','integer'],
 ['deposits','deposit_date','date'],['deposits','receipt_number','character varying'],
 ['deposits','receipt_data','bytea'],['deposits','api_key','text'],
 ['users','name','text'],['users','password_hash','text'],['users','email','text'],
 ['password_reset_tokens','token','text'],['unknown_module','amount','numeric']
].map(([table_name,column_name,data_type])=>({table_name,column_name,data_type}));
async function database(handler,fn){const original=pool.query;const calls=[];pool.query=async(sql,values)=>{calls.push({sql,values});return handler(sql,values);};try{await fn(calls);}finally{pool.query=original;}}
test('live discovery includes new safe fields but excludes credentials, files and unregistered tables',async()=>{
 await database(()=>({rows:[...definitions,{table_name:'deposits',column_name:'bank_name',data_type:'text'}]}),async()=>{
  const catalog=await knowledge.catalog(admin);
  assert.ok(catalog.deposits.some(c=>c.name==='bank_name'));
  assert.ok(!catalog.deposits.some(c=>/receipt_data|api_key/.test(c.name)));
  assert.deepEqual(catalog.users,[{name:'name',type:'text'}]);
  assert.equal(catalog.password_reset_tokens,undefined);assert.equal(catalog.unknown_module,undefined);
 });
});
test('new company-wide tools reject all non-admin roles before querying the database',async()=>{
 await database(()=>{throw new Error('Database must not be reached');},async calls=>{
  for(const role of ['Manager','Cashier','Stock Manager','Delivery Person']){
   await assert.rejects(knowledge.context({role}),/only to Admin/);
   await assert.rejects(knowledge.run('query_business_records',{table:'deposits'},{role}),/only to Admin/);
   await assert.rejects(knowledge.catalog({role}),/only to Admin/);
  }
  assert.equal(calls.length,0);
 });
});
test('exact totals by shop use aggregate queries and parameterized historical filters',async()=>{
 await database(sql=>({rows:sql.includes('information_schema')?definitions:[{shop_id:1,record_count:'2',sum_amount:'30.25'}]}),async calls=>{
  const result=await knowledge.queryRecords({table:'deposits',count:true,sum_columns:['amount'],group_by:'shop_id',filters:[{column:'deposit_date',op:'gte',value:'2026-01-01'}]},admin);
  assert.equal(result.rows[0].sum_amount,'30.25');
  const query=calls.at(-1);assert.match(query.sql,/SUM\("amount"\)/);assert.match(query.sql,/GROUP BY "shop_id"/);
  assert.deepEqual(query.values,['2026-01-01',31,0]);assert.ok(!query.sql.includes('2026-01-01'));
 });
});
test('table and column injection and access to secrets are rejected; filter text is data',async()=>{
 await database(sql=>({rows:sql.includes('information_schema')?definitions:[]}),async calls=>{
  for(const input of [{table:'deposits; DROP TABLE sales'},{table:'users',columns:['password_hash']},{table:'deposits',columns:['receipt_data']},{table:'deposits',sum_columns:['receipt_number']},{table:'deposits',filters:[{column:'amount',op:'; DROP TABLE sales',value:1}]}])await assert.rejects(knowledge.queryRecords(input,admin));
  const text="'; DROP TABLE sales; --";
  await knowledge.queryRecords({table:'deposits',filters:[{column:'receipt_number',op:'contains',value:text}]},admin);
  assert.ok(!calls.at(-1).sql.includes('DROP TABLE'));assert.equal(calls.at(-1).values[0],'%'+text+'%');
 });
});
test('each lookup reads fresh data and signals when more records exist',async()=>{
 let version=1;
 await database(sql=>({rows:sql.includes('information_schema')?definitions:[{id:version},{id:2}]}),async()=>{
  const first=await knowledge.queryRecords({table:'deposits',limit:1},admin);version=3;
  const next=await knowledge.queryRecords({table:'deposits',limit:1},admin);
  assert.equal(first.rows[0].id,1);assert.equal(next.rows[0].id,3);assert.equal(next.has_more,true);
 });
});
