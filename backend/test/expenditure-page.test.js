const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../../Reliavolt-Inventory-Frontend/js/expenditures.js'), 'utf8');
const record = {id:1, expense_date:'2026-10-21', description:'Transport', category:'Travel', amount:'12.50',shop_id:3,shop_name:'Main',recorded_by:'Admin'};
async function page({get, post, admin = true} = {}) {
    const elements = {};
    const el = id => elements[id] ||= {value:'',textContent:'',innerHTML:'',disabled:false,listeners:{},
        addEventListener(name, fn) {this.listeners[name] = fn;},reportValidity() {return true;}};
    let init;
    const calls = [];
    const context = {
        document:{getElementById:el,addEventListener:(name,fn)=>{init=fn;},createElement:()=>({set textContent(s){this.innerHTML=s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');}})},
        todayStr:()=> '2026-10-21',formatCurrency:n=>'Le '+n,isAdmin:()=>admin,getCurrentUserShopId:()=>3,getCurrentUserName:()=> 'Admin',
        api:{get:async url=>{calls.push(['GET',url]);return get ? get(url) : url==='/api/shops' ? [{id:3,name:'Main'}] : [];},
             post:async (url,body)=>{calls.push(['POST',url,body]);return post ? post(url,body) : {...record,...body};}}
    };
    vm.runInNewContext(source,context);
    await init();
    return {el,calls,submit:()=>el('expenditureForm').listeners.submit({preventDefault(){}}),refresh:()=>el('refreshExpenses').listeners.click()};
}
test('frontend copies stay identical',()=>{
 assert.equal(source,fs.readFileSync(path.join(__dirname,'../../expenditures.js'),'utf8'));
});
test('failed first load recovers through Refresh and enables recording',async()=>{
 let fail=true;
 const p=await page({get:url=>{if(fail)throw new Error('Cannot reach server');return url==='/api/shops'?[{id:3,name:'Main'}]:[record];}});
 assert.equal(p.el('saveExpenditure').disabled,true);
 fail=false; await p.refresh();
 assert.equal(p.el('saveExpenditure').disabled,false);
 assert.equal(p.el('expenseMessage').textContent,'');
 assert.match(p.el('expenseRows').innerHTML,/Transport/);
 assert.equal(p.el('expenseTotal').textContent,'Le 12.5');
});
test('a confirmed save renders immediately without fetching again',async()=>{
 const p=await page();
 p.el('expenseDescription').value='Transport';p.el('expenseCategory').value='Travel';p.el('expenseAmount').value='12.50';
 await p.submit();
 assert.equal(p.calls.filter(c=>c[0]==='GET').length,2);
 assert.equal(p.calls.filter(c=>c[0]==='POST').length,1);
 assert.match(p.el('expenseRows').innerHTML,/Transport/);
 assert.equal(p.el('expenseTotal').textContent,'Le 12.5');
 assert.equal(p.el('expenseMessage').textContent,'Expenditure recorded.');
 assert.equal(p.el('expenseAmount').value,'');
});
test('failed save preserves entered data and does not claim success',async()=>{
 const p=await page({post:()=>{throw new Error('Connection lost');}});
 p.el('expenseDescription').value='Transport';p.el('expenseAmount').value='12.50';
 await p.submit();
 assert.equal(p.el('expenseDescription').value,'Transport');
 assert.equal(p.el('expenseAmount').value,'12.50');
 assert.equal(p.el('expenseMessage').textContent,'Connection lost');
 assert.equal(p.el('saveExpenditure').disabled,false);
});
test('date filtering updates records and isolated expenditure total',async()=>{
 const p=await page({get:url=>url==='/api/shops'?[{id:3,name:'Main'}]:[record,{...record,id:2,expense_date:'2026-10-20',amount:'4.25'}]});
 assert.equal(p.el('expenseTotal').textContent,'Le 16.75');
 p.el('filterFrom').value='2026-10-21';p.el('filterFrom').listeners.change();
 assert.equal(p.el('expenseTotal').textContent,'Le 12.5');
});
test('missing deployed route is identified; failed refresh retains loaded records',async()=>{
 let fail=false;
 const p=await page({get:url=>{if(url==='/api/shops')return [{id:3,name:'Main'}];if(fail)throw new Error('Route GET /api/expenditures not found');return [record];}});
 fail=true;await p.refresh();
 assert.match(p.el('expenseMessage').textContent,/server needs the expenditure update/);
 assert.match(p.el('expenseRows').innerHTML,/Transport/);
 assert.equal(p.el('expenseTotal').textContent,'Le 12.5');
});
test('pending save cannot be submitted twice',async()=>{
 let complete;
 const p=await page({post:()=>new Promise(resolve=>{complete=resolve;})});
 p.el('expenseAmount').value='12.50';
 const pending=p.submit();await p.submit();
 assert.equal(p.calls.filter(c=>c[0]==='POST').length,1);
 assert.equal(p.el('saveExpenditure').disabled,true);
 complete(record);await pending;
 assert.equal(p.el('saveExpenditure').disabled,false);
});
