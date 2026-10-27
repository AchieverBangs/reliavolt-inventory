const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');
for(const file of ['dashboard.js','Reliavolt-Inventory-Frontend/js/dashboard.js']){
const source=fs.readFileSync(file,'utf8');
function stats(quantity,sales,summary){const result={};const ctx={todayStr:()=>'',isSameDay:()=>false,isSameMonth:()=>false,isAdmin:()=>true,LOW_STOCK_THRESHOLD:5,setEl:(id,value)=>result[id]=value,formatCurrency:n=>n};vm.createContext(ctx);vm.runInContext(source.slice(0,source.indexOf('// ===== PRODUCTS BY SHOP')),ctx);ctx.products=[{id:1,quantity,cost_price:10,selling_price:20}];ctx.sales=sales;ctx.summary=summary;vm.runInContext('_products=products;_sales=sales;_stockSummary=summary;renderDashboardStats()',ctx);return result;}
test(file+': cash and unpaid credit sales do not reduce lifetime stock',()=>{
const summary=[{id:1,total_added:10}];for(const [quantity,sales] of [[10,[]],[7,[]],[7,[{product_id:1,qty:3}]]]){const r=stats(quantity,sales,summary);assert.equal(r.statEverSellingValue,200);assert.equal(r.statEverCostValue,100);}
assert.equal(stats(12,[],[{id:1,total_added:15}]).statEverSellingValue,300);
assert.equal(stats(4,[],summary).statEverSellingValue,200);
});
test(file+': unavailable ledger is not shown as zero',()=>assert.equal(stats(7,[],null).statEverSellingValue,'Unavailable'));
}
