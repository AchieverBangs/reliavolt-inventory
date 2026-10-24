const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '../..');
const source = fs.readFileSync(path.join(root, 'deposits.js'), 'utf8');
const shops = [{id:1,name:'Main'}, {id:2,name:'Branch'}, {id:3,name:'Empty'}];
const rows = [
    {id:1,shop_id:1,shop_name:'Main',amount:'0.10',receipt_number:'MAIN-1',deposit_date:'2026-01-01'},
    {id:2,shop_id:1,shop_name:'Main',amount:'0.20',receipt_number:'MAIN-2',deposit_date:'2026-01-01'},
    {id:3,shop_id:2,shop_name:'Branch',amount:'40.00',receipt_number:'BRANCH-1',deposit_date:'2026-01-01'}
];
async function page(get = url => url === '/api/shops' ? shops : rows, timers = {setTimeout, clearTimeout}) {
    const elements = {};
    const el = id => elements[id] ||= {value:'',innerHTML:'',textContent:'',disabled:false,listeners:{},addEventListener(event,fn){this.listeners[event]=fn;}};
    let init;
    vm.runInNewContext(source, {
        document:{getElementById:el,addEventListener:(event,fn)=>{init=fn;},createElement:()=>({set textContent(value){this.innerHTML=String(value);}})},
        ...timers, api:{get:async url=>get(url)},isAdmin:()=>true,getCurrentUserRole:()=> 'Admin',formatCurrency:value=>'Le '+Number(value).toFixed(2)
    });
    await init();
    return {el,filter:id=>{el('filterShop').value=id;el('filterShop').listeners.change();},refresh:()=>el('refreshDeposits').listeners.click()};
}
test('shop filter updates totals and history, including shops without deposits', async()=>{
    const p=await page();
    assert.equal(p.el('depositTotal').textContent,'Le 40.30');
    p.filter('1');
    assert.equal(p.el('depositTotal').textContent,'Le 0.30');
    assert.match(p.el('depositRows').innerHTML,/MAIN-1/);
    assert.doesNotMatch(p.el('depositRows').innerHTML,/BRANCH-1/);
    p.filter('2'); assert.equal(p.el('depositTotal').textContent,'Le 40.00');
    p.filter('3'); assert.equal(p.el('depositTotal').textContent,'Le 0.00');
    assert.match(p.el('depositRows').innerHTML,/No deposits/);
    p.filter(''); assert.equal(p.el('depositTotal').textContent,'Le 40.30');
});
test('failed deposit request still loads shops and Refresh recovers totals and filtering',async()=>{
    let failed=true;
    const p=await page(url=>{if(url==='/api/shops')return shops;if(failed)throw new Error('Server unavailable');return rows;});
    assert.match(p.el('filterShop').innerHTML,/Branch/);
    assert.equal(p.el('depositTotal').textContent,'Unavailable');
    assert.match(p.el('depositRecordsMessage').textContent,/Server unavailable/);
    failed=false; await p.refresh();
    assert.equal(p.el('depositRecordsMessage').textContent,'');
    p.filter('2');assert.equal(p.el('depositTotal').textContent,'Le 40.00');
    await p.refresh();assert.equal(p.el('filterShop').value,'2');
    assert.equal(p.el('depositTotal').textContent,'Le 40.00');
});
test('both frontend copies load versioned deposit scripts to avoid stale browser code',()=>{
    assert.equal(source,fs.readFileSync(path.join(root,'Reliavolt-Inventory-Frontend/js/deposits.js'),'utf8'));
    for(const base of ['', 'Reliavolt-Inventory-Frontend/']){
        const html=fs.readFileSync(path.join(root,base,'deposits.html'),'utf8');
        assert.match(html,/src="(?:js\/)?deposits\.js\?v=deposits-edit-1"/);
        assert.match(html,/id="depositRecordsMessage"/);
    }
});

test('a stalled request stops loading and makes Refresh available',async()=>{
 const p=await page(url=>url==='/api/shops'?shops:new Promise(()=>{}),{setTimeout:fn=>setTimeout(fn,5),clearTimeout});
 assert.equal(p.el('refreshDeposits').disabled,false);
 assert.equal(p.el('depositTotal').textContent,'Unavailable');
 assert.match(p.el('depositRecordsMessage').textContent,/took too long/);
 assert.doesNotMatch(p.el('depositRows').innerHTML,/Loading deposits/);
});
