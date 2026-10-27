document.addEventListener('DOMContentLoaded', async () => {
    const el=id=>document.getElementById(id);
    const esc=value=>{const span=document.createElement('span');span.textContent=String(value??'');return span.innerHTML;};
    let shops=[], users=[], records=[], editing=null, busy=false, ready=false;
    const message=text=>{el('preMessage').textContent=text;};
    const get=async path=>{
        let timer;
        try{return await Promise.race([api.get(path),new Promise((resolve,reject)=>{
            timer=setTimeout(()=>reject(new Error('The server took too long to respond. Use Refresh to retry.')),20000);
        })]);}finally{clearTimeout(timer);}
    };
    const controls=()=>{el('preSave').disabled=busy||!ready||!shops.length;el('preRefresh').disabled=busy;el('preCancel').disabled=busy;};
    const allocationTotal=()=>{
        const sum=shops.reduce((total,shop)=>total+Number(el('allocation-'+shop.id).value||0),0);
        el('preAllocationTotal').textContent='Allocated: '+sum+' / '+(el('preQuantity').value||0);
    };
    const reset=()=>{
        editing=null;el('preForm').reset();el('preFormTitle').textContent='Add goods awaiting arrival';
        el('preSave').textContent='Save pre-inventory';el('preCancel').hidden=true;el('preCommission').value='0';allocationTotal();
    };
    const render=()=>{
        const shop=el('preFilterShop').value,status=el('preStatus').value;
        const shown=records.filter(row=>(!shop||row.allocations.some(a=>String(a.shop_id)===shop))&&(!status||(status==='received')===!!row.received_at));
        const values=shown.map(row=>{
            const quantity=shop?row.allocations.filter(a=>String(a.shop_id)===shop).reduce((sum,a)=>sum+Number(a.quantity),0):Number(row.quantity);
            const cost=Math.round(Number(row.cost_price)*100),selling=Math.round(Number(row.selling_price)*100),commission=Math.round(Number(row.commission||0)*100);
            return {quantity,cost:cost*quantity/100,selling:selling*quantity/100,commission:commission*quantity/100,profit:(selling-cost-commission)*quantity/100,unitProfit:(selling-cost-commission)/100};
        });
        const totals=values.reduce((sum,value)=>{for(const key of ['quantity','cost','selling','commission','profit'])sum[key]+=value[key];return sum;},{quantity:0,cost:0,selling:0,commission:0,profit:0});
        for(const [id,key] of [['preTotalCost','cost'],['preTotalSelling','selling'],['preTotalCommission','commission'],['preTotalProfit','profit']])el(id).textContent=formatCurrency(totals[key]);
        el('preTotalsScope').textContent=shown.length+' product entries, '+totals.quantity+' units matching the selected shop and status. Expected profit = selling total - cost total - commission total.';
        el('preRows').innerHTML=shown.length?shown.map((row,index)=>'<tr><td>'+esc(row.name)+'<br>'+esc(row.reference||'')+'</td><td>'+values[index].quantity+'</td><td>'+esc(formatCurrency(row.cost_price))+'</td><td>'+esc(formatCurrency(row.selling_price))+'</td><td>'+esc(formatCurrency(row.commission||0))+'</td><td>'+esc(formatCurrency(values[index].cost))+'</td><td>'+esc(formatCurrency(values[index].selling))+'</td><td>'+esc(formatCurrency(values[index].unitProfit))+'</td><td>'+esc(formatCurrency(values[index].profit))+'</td><td>'+row.allocations.map(a=>esc(a.shop_name)+': '+a.quantity+' - '+esc(users.find(user=>Number(user.id)===Number(a.commission_user_id))?.name||'Person who makes the sale')).join('<br>')+'</td><td>'+ (row.received_at?'Transferred '+esc(new Date(row.received_at).toLocaleDateString()):'Awaiting arrival')+'</td><td>'+(row.received_at?'<a href="inventory.html">View inventory</a>':'<button type="button" class="btn btn-secondary" data-edit="'+row.id+'">Edit</button> <button type="button" class="btn btn-primary" data-receive="'+row.id+'">Arrived — transfer to inventory</button>')+'</td></tr>').join(''):'<tr><td colspan="12">No goods match these filters.</td></tr>';
    };
    const load=async()=>{
        if(busy)return;busy=true;controls();message('');
        try{
            const [allShops,items,allUsers]=await Promise.all([get('/api/shops'),get('/api/pre-inventory'),get('/api/users')]);
            if(!allShops||!items||!allUsers)return;
            if(!Array.isArray(allShops)||!Array.isArray(items)||!Array.isArray(allUsers))throw new Error('Unexpected server response.');
            const draft=new Map(shops.map(shop=>[shop.id,{quantity:el('allocation-'+shop.id).value,owner:el('recipient-'+shop.id).value}]));
            const selected=el('preFilterShop').value;
            shops=allShops;records=items;users=allUsers;
            el('preAllocations').innerHTML='<div class="table-responsive"><table class="data-table"><thead><tr><th>Shop</th><th>Quantity</th><th>Commission recipient</th></tr></thead><tbody>'+shops.map(shop=>'<tr><td>'+esc(shop.name)+'</td><td><input aria-label="Quantity for '+esc(shop.name)+'" class="form-control" type="number" min="0" max="2147483647" step="1" value="0" id="allocation-'+Number(shop.id)+'" required></td><td><select aria-label="Commission recipient for '+esc(shop.name)+'" class="form-control" id="recipient-'+Number(shop.id)+'"><option value="">Person who makes the sale</option>'+users.filter(user=>Number(user.shop_id)===Number(shop.id)).map(user=>'<option value="'+Number(user.id)+'">'+esc(user.name)+'</option>').join('')+'</select></td></tr>').join('')+'</tbody></table></div>';
            for(const shop of shops){el('allocation-'+shop.id).value=draft.get(shop.id)?.quantity||0;el('recipient-'+shop.id).value=draft.get(shop.id)?.owner||'';}
            el('preFilterShop').innerHTML='<option value="">All shops</option>'+shops.map(shop=>'<option value="'+Number(shop.id)+'">'+esc(shop.name)+'</option>').join('');
            el('preFilterShop').value=shops.some(shop=>String(shop.id)===selected)?selected:'';
            ready=true;render();allocationTotal();
            if(!shops.length)message('Create a shop before allocating goods.');
        }catch(err){message('Could not load pre-inventory: '+err.message);if(!ready)el('preRows').innerHTML='<tr><td colspan="12">Unable to load goods. Use Refresh to retry.</td></tr>';}
        finally{busy=false;controls();}
    };
    el('preQuantity').addEventListener('input',allocationTotal);
    el('preAllocations').addEventListener('input',allocationTotal);
    el('preFilterShop').addEventListener('change',render);el('preStatus').addEventListener('change',render);
    el('preRefresh').addEventListener('click',load);el('preCancel').addEventListener('click',()=>{if(!busy)reset();});
    el('preForm').addEventListener('submit',async event=>{
        event.preventDefault();if(busy||!ready||!el('preForm').reportValidity())return;
        const body={name:el('preName').value.trim(),reference:el('preReference').value.trim(),category:el('preCategory').value.trim(),brand:el('preBrand').value.trim(),cost_price:el('preCost').value,selling_price:el('prePrice').value,commission:el('preCommission').value||'0',quantity:Number(el('preQuantity').value),allocations:shops.map(shop=>({shop_id:Number(shop.id),quantity:Number(el('allocation-'+shop.id).value),commission_user_id:el('recipient-'+shop.id).value?Number(el('recipient-'+shop.id).value):null})).filter(a=>a.quantity>0)};
        if(body.allocations.reduce((sum,a)=>sum+a.quantity,0)!==body.quantity){message('Shop allocations must add up to the purchased quantity.');return;}
        busy=true;controls();message('');let saved=false;
        try{const result=await (editing?api.put('/api/pre-inventory/'+editing,body):api.post('/api/pre-inventory',body));if(!result)return;reset();saved=true;}
        catch(err){message(err.message);}finally{busy=false;controls();}
        if(saved){await load();if(ready)message('Pre-inventory saved. These goods are not yet in saleable stock.');}
    });
    el('preRows').addEventListener('click',async event=>{
        if(busy)return;
        const edit=event.target.closest('[data-edit]'), receive=event.target.closest('[data-receive]');
        if(!edit&&!receive)return;
        const row=records.find(item=>Number(item.id)===Number(edit?edit.dataset.edit:receive.dataset.receive));
        if(!row||row.received_at)return;
        if(edit){
            el('preCommission').value=row.commission??0;
            editing=row.id;el('preFormTitle').textContent='Edit goods awaiting arrival';el('preSave').textContent='Save changes';el('preCancel').hidden=false;
            for(const [id,key] of [['preName','name'],['preReference','reference'],['preCategory','category'],['preBrand','brand'],['preCost','cost_price'],['prePrice','selling_price'],['preQuantity','quantity']])el(id).value=row[key]??'';
            for(const shop of shops){const allocation=row.allocations.find(a=>Number(a.shop_id)===Number(shop.id));el('allocation-'+shop.id).value=allocation?.quantity||0;el('recipient-'+shop.id).value=allocation?.commission_user_id??'';}
            allocationTotal();el('preForm').scrollIntoView({behavior:'smooth'});return;
        }
        if(!confirm('Have these goods arrived? Transfer '+row.quantity+' units of '+row.name+' to main inventory?\n'+row.allocations.map(a=>a.shop_name+': '+a.quantity).join('\n')+'\nThis creates a product entry in each shop and can only be done once.'))return;
        busy=true;controls();receive.disabled=true;let transferred=false;
        try{const result=await api.post('/api/pre-inventory/'+row.id+'/receive',{});if(!result)return;row.received_at=new Date().toISOString();if(editing===row.id)reset();render();transferred=true;}
        catch(err){message(err.message);}finally{busy=false;controls();receive.disabled=false;}
        if(transferred){await load();message('Goods transferred to the allocated shops. Open Inventory to view the stock.');}
    });
    if(!isAdmin()){el('preSummary').hidden=true;el('preEditor').hidden=true;el('preRefresh').disabled=true;el('preFilterShop').disabled=true;el('preStatus').disabled=true;message('Pre-inventory and commission allocation are available only to administrators.');el('preRows').innerHTML='<tr><td colspan="12">Administrator access required.</td></tr>';return;}
    await load();
});
