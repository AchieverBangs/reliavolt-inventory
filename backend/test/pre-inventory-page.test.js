const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'../..');
const source=fs.readFileSync(path.join(root,'pre-inventory.js'),'utf8');
async function page(){
 const elements={};
 const el=id=>elements[id]||=( {value:'',innerHTML:'',textContent:'',listeners:{},addEventListener(event,fn){this.listeners[event]=fn;},reportValidity:()=>true,scrollIntoView(){},reset(){}} );
 let init;const calls=[];
 const item={id:1,name:'Panel',quantity:10,cost_price:'100',selling_price:'150',allocations:[{shop_id:3,shop_name:'Bo',quantity:4},{shop_id:7,shop_name:'Freetown',quantity:6}]};
 el('preStatus').value='pending';
 vm.runInNewContext(source,{setTimeout,clearTimeout,confirm:()=>true,isAdmin:()=>true,formatCurrency:n=>'Le '+n,
  document:{getElementById:el,addEventListener:(event,fn)=>{init=fn;},createElement:()=>({set textContent(value){this.innerHTML=String(value);}})},
  api:{get:async url=>url==='/api/shops'?[{id:3,name:'Bo'},{id:7,name:'Freetown'}]:[item],
   post:async(url,body)=>{calls.push({url,body});if(url.endsWith('/receive'))item.received_at='2026-01-01';return {id:1};},
   put:async(url,body)=>{calls.push({url,body});return {id:1};}}
 });
 await init();return {el,calls,click:async(type,id)=>el('preRows').listeners.click({target:{closest:selector=>selector==='[data-'+type+']'?{dataset:{[type]:String(id)}}:null}})};
}
test('pre-inventory shows shop allocations, filters, and locks actions after transfer',async()=>{
 const p=await page();assert.match(p.el('preRows').innerHTML,/Bo: 4/);assert.match(p.el('preRows').innerHTML,/Freetown: 6/);
 p.el('preFilterShop').value='9';p.el('preFilterShop').listeners.change();assert.match(p.el('preRows').innerHTML,/No goods/);
 p.el('preFilterShop').value='';await p.click('receive',1);
 assert.equal(p.calls[0].url,'/api/pre-inventory/1/receive');
 p.el('preStatus').value='received';p.el('preStatus').listeners.change();
 assert.match(p.el('preRows').innerHTML,/View inventory/);assert.doesNotMatch(p.el('preRows').innerHTML,/data-receive/);
});
test('editing fills saved prices and quantities; mismatched allocation cannot be saved',async()=>{
 const p=await page();await p.click('edit',1);
 assert.equal(p.el('preName').value,'Panel');assert.equal(p.el('preCost').value,'100');
 assert.equal(p.el('allocation-3').value,4);assert.equal(p.el('allocation-7').value,6);
 p.el('preQuantity').value='11';await p.el('preForm').listeners.submit({preventDefault(){}});
 assert.match(p.el('preMessage').textContent,/must add up/);assert.equal(p.calls.length,0);
 p.el('preQuantity').value='10';await p.el('preForm').listeners.submit({preventDefault(){}});
 assert.equal(p.calls[0].url,'/api/pre-inventory/1');assert.equal(p.calls[0].body.allocations.length,2);
});
test('frontend copies match and dashboard shortcut follows View Reports',()=>{
 assert.equal(source,fs.readFileSync(path.join(root,'Reliavolt-Inventory-Frontend/js/pre-inventory.js'),'utf8'));
 for(const base of ['', 'Reliavolt-Inventory-Frontend/']){
  const html=fs.readFileSync(path.join(root,base,'dashboard.html'),'utf8');
  assert.match(html,/<span>View Reports<\/span>\s*<\/a>\s*<a href="pre-inventory.html"/);
 }
});
