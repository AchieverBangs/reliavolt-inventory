const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'../..');
const source=fs.readFileSync(path.join(root,'credit.js'),'utf8');
function page(){
    const elements={};
    for(const id of ['creditTableBody','creditStatusFilter','searchCreditCustomer','totalOwingCount','totalOutstanding'])elements[id]={value:'',textContent:'',innerHTML:''};
    elements.creditStatusFilter.value='outstanding';
    const context={document:{getElementById:id=>elements[id],addEventListener(){}},
        isAdmin:()=>false,formatCurrency:n=>'Le '+Number(n),showToast(){},api:{get:async()=>[
            {id:1,name:'Open customer',phone:'111',credit_balance:'50.00'},
            {id:2,name:'Paid customer',phone:'222',credit_balance:'0.00'}
        ]}};
    vm.createContext(context);vm.runInContext(source,context);
    return {elements,context};
}
test('paid customers remain discoverable without changing outstanding totals',async()=>{
    const {elements,context}=page();
    await context.reloadCreditCustomers();
    assert.match(elements.creditTableBody.innerHTML,/Open customer/);
    assert.doesNotMatch(elements.creditTableBody.innerHTML,/Paid customer/);
    assert.equal(elements.totalOwingCount.textContent,1);
    assert.equal(elements.totalOutstanding.textContent,'Le 50');
    elements.creditStatusFilter.value='paid';context.renderCreditTable();
    assert.match(elements.creditTableBody.innerHTML,/Paid customer/);
    assert.match(elements.creditTableBody.innerHTML,/Fully Paid/);
    assert.match(elements.creditTableBody.innerHTML,/openCreditHistory\(2\)/);
    assert.doesNotMatch(elements.creditTableBody.innerHTML,/Record Payment|Open customer/);
    elements.creditStatusFilter.value='all';context.renderCreditTable('222');
    assert.match(elements.creditTableBody.innerHTML,/Paid customer/);
    assert.doesNotMatch(elements.creditTableBody.innerHTML,/Open customer/);
    context.api.get=async()=>{throw new Error('offline');};
    await context.reloadCreditCustomers();
    assert.match(elements.creditTableBody.innerHTML,/Paid customer/);
});
test('root and deployed credit pages and scripts match with Dashboard first',()=>{
    assert.equal(source,fs.readFileSync(path.join(root,'Reliavolt-Inventory-Frontend/js/credit.js'),'utf8'));
    const html=fs.readFileSync(path.join(root,'credit.html'),'utf8');
    assert.equal(html,fs.readFileSync(path.join(root,'Reliavolt-Inventory-Frontend/credit.html'),'utf8'));
    assert.match(html,/credit\.js\?v=20261102-history/);
    const nav=html.slice(html.indexOf('<nav'),html.indexOf('</nav>'));
    assert.match(nav.match(/class="nav-label">([^<]+)/)[1],/^Dashboard$/);
});
