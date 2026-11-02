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
    assert.match(html,/credit\.js\?v=20261102-returns/);
    const nav=html.slice(html.indexOf('<nav'),html.indexOf('</nav>'));
    assert.match(nav.match(/class="nav-label">([^<]+)/)[1],/^Dashboard$/);
});

test('only admins see item editing and the editor shows the existing price and payments',()=>{
    const {context,elements}=page();
    for(const id of ['creditHistoryBody','editCreditProduct','editCreditReceipt','editCreditPaid','editCreditQty','editCreditPrice'])elements[id]={value:'',textContent:'',innerHTML:''};
    context.can=()=>false;context.formatDateTime=d=>d;
    const modals=[];context.openModal=id=>modals.push(id);
    vm.runInContext(`_activeHistoryCustomerId=1; _activeHistoryData={customer:{id:1},timeline:[
        {id:10,type:'sale',product_name:'Panel',qty:2,unit_price:'50.00',total:'100.00',amount:'80.00',credit_amount_paid:'30.00',receipt_no:'R-10',at:'2026-09-10'}
    ]};`,context);
    context.renderCreditHistoryBody();
    assert.doesNotMatch(elements.creditHistoryBody.innerHTML,/openCreditItemEditor/);
    context.openCreditItemEditor(10);
    assert.equal(modals.length,0);
    context.isAdmin=()=>true;
    context.renderCreditHistoryBody();
    assert.match(elements.creditHistoryBody.innerHTML,/openCreditItemEditor\(10\)/);
    context.openCreditItemEditor(10);
    assert.equal(modals[0],'editCreditItemModal');
    assert.equal(elements.editCreditQty.value,2);
    assert.equal(elements.editCreditPrice.value,'50.00');
    assert.equal(elements.editCreditPaid.textContent,'Le 50');
});

test('failed item save preserves inputs, blocks duplicate submission and allows retry',async()=>{
    const {context,elements}=page();
    context.isAdmin=()=>true;
    for(const id of ['editCreditQty','editCreditPrice','saveCreditItemBtn'])elements[id]={value:'',disabled:false};
    elements.editCreditQty.value='3';elements.editCreditPrice.value='60.00';
    vm.runInContext('_editingCreditItemId=10;_activeHistoryCustomerId=1;',context);
    let fail,calls=0;
    context.api.put=async(url,body)=>{
        calls++;assert.equal(url,'/api/customers/1/credit-items/10');
        assert.equal(body.qty,3);assert.equal(body.unit_price,'60.00');
        return new Promise((resolve,reject)=>{fail=reject;});
    };
    const pending=context.saveCreditItem();
    await context.saveCreditItem();
    assert.equal(calls,1);assert.equal(elements.saveCreditItemBtn.disabled,true);
    fail(new Error('Insufficient stock'));await pending;
    assert.equal(elements.editCreditQty.value,'3');
    assert.equal(elements.editCreditPrice.value,'60.00');
    assert.equal(elements.saveCreditItemBtn.disabled,false);
    assert.equal(vm.runInContext('_editingCreditItemId',context),10);
});
