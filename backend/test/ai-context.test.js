const test=require('node:test');
const assert=require('node:assert/strict');
const request=require('supertest');
const jwt=require('jsonwebtoken');
const pool=require('../src/db/pool');
const calls=[];
// Replace the paid provider with a local fake before the route is loaded.
const sdkPath=require.resolve('@anthropic-ai/sdk');require(sdkPath);
require.cache[sdkPath].exports=class {constructor(){this.messages={create:async body=>{calls.push(body);return {stop_reason:'end_turn',content:[{type:'text',text:'Test answer'}]};}};}};
process.env.ANTHROPIC_API_KEY='test-key';process.env.JWT_SECRET='ai-context-test';
const app=require('../src/app');
const token=role=>jwt.sign({id:1,name:'Test',role,shopId:1},process.env.JWT_SECRET);
test('admin receives automatic fresh context on every turn; staff never receive it or its tools',async()=>{
 const original=pool.query;let version=1;
 pool.query=async(sql)=>({rows:sql.startsWith('SELECT can_write')?[{can_write:true}]:sql.includes('information_schema')?[{table_name:'deposits',column_name:'receipt_number_'+version,data_type:'text'}]:[]});
 try{
  for(const role of ['Admin','Manager','Cashier','Stock Manager']){
   const response=await request(app).post('/api/ai/ask').auth(token(role),{type:'bearer'}).send({question:'What can you help with?'});
   assert.equal(response.status,200);
   const body=calls.at(-1);
   assert.equal(body.tools.some(t=>t.name==='query_business_records'),role==='Admin');
   assert.equal(body.system.includes('<business_data>'),role==='Admin');
  }
  version=2;
  await request(app).post('/api/ai/ask').auth(token('Admin'),{type:'bearer'}).send({question:'Anything new?'});
  assert.match(calls.at(-1).system,/receipt_number_2/);
 }finally{pool.query=original;}
});
