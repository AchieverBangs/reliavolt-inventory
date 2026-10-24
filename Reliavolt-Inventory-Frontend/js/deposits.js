document.addEventListener('DOMContentLoaded', async () => {
    const el = id => document.getElementById(id);
    const esc = value => { const node = document.createElement('span'); node.textContent = String(value ?? ''); return node.innerHTML; };
    const message = value => {
        el('depositMessage').textContent = value;
        el('depositRecordsMessage').textContent = value;
    };
    let busy = false, ready = false, shops = [], records = [], editingId = null;
    const resetEditor = () => {
        editingId = null;
        el('depositFormTitle').textContent = 'Record bank deposit';
        el('saveDeposit').textContent = 'Record deposit';
        el('cancelDepositEdit').hidden = true;
        el('bankReceipt').required = true;
        el('existingReceipt').textContent = '';
        el('depositAmount').value = ''; el('receiptNumber').value = ''; el('bankReceipt').value = '';
        el('depositDate').value = new Date().toISOString().slice(0, 10);
    };
    const loadResource = async path => {
        let timer;
        try {
            return await Promise.race([
                api.get(path),
                new Promise((resolve, reject) => {
                    timer = setTimeout(() => reject(new Error('The server took too long to load ' + (path === '/api/shops' ? 'shops' : 'deposits') + '. Check your connection and try again.')), 20000);
                })
            ]);
        } finally { clearTimeout(timer); }
    };
    const controls = () => {
        el('saveDeposit').disabled = busy || !ready || !shops.length;
        el('refreshDeposits').disabled = busy;
        el('filterShop').disabled = !shops.length;
        el('cancelDepositEdit').disabled = busy;
    };
    const render = () => {
        const selectedShop = el('filterShop').value;
        const shown = records.filter(row => !selectedShop || String(row.shop_id) === selectedShop);
        const totals = new Map(shops.filter(shop => !selectedShop || String(shop.id) === selectedShop)
            .map(shop => [String(shop.id), { name: shop.name, cents: 0, count: 0 }]));
        for (const row of shown) {
            const key = String(row.shop_id);
            if (!totals.has(key)) totals.set(key, { name: row.shop_name || 'Unknown shop', cents: 0, count: 0 });
            const total = totals.get(key);
            total.cents += Math.round(Number(row.amount) * 100);
            total.count++;
        }
        el('depositTotal').textContent = formatCurrency([...totals.values()].reduce((sum, row) => sum + row.cents, 0) / 100);
        el('depositShopTotals').innerHTML = totals.size ? [...totals.values()].map(row => '<tr><td>' + esc(row.name) + '</td><td>' + row.count + '</td><td>' + esc(formatCurrency(row.cents / 100)) + '</td></tr>').join('') : '<tr><td colspan="3">No shops found.</td></tr>';
        el('depositRows').innerHTML = shown.length ? shown.map(row => '<tr><td>' + esc(row.deposit_date) +
            '</td><td>' + esc(row.receipt_number) + '</td><td>' + esc(formatCurrency(row.amount)) +
            '</td><td>' + esc(row.shop_name) + '</td><td>' + esc(row.recorded_by) + '</td><td>' +
            esc(new Date(row.created_at).toLocaleString()) + '</td><td><button class="btn btn-secondary" type="button" data-receipt="' + Number(row.id) + '">Download receipt</button> <button class="btn btn-secondary" type="button" data-edit="' + Number(row.id) + '">Edit</button></td></tr>').join('') : '<tr><td colspan="7">No deposits recorded.</td></tr>';
    };
    const load = async () => {
        if (busy) return;
        busy = true; controls(); message('');
        try {
            // Populate the shop selector even when loading deposits fails.
            const [shopResult, depositResult] = await Promise.allSettled([loadResource('/api/shops'), loadResource('/api/deposits')]);
            if (shopResult.status === 'rejected') throw shopResult.reason;
            const allShops = shopResult.value;
            if (!allShops) return;
            if (!Array.isArray(allShops)) throw new Error('Unexpected shop response.');
            shops = isAdmin() ? allShops : allShops.filter(shop => Number(shop.id) === Number(getCurrentUserShopId()));
            const selected = el('depositShop').value;
            el('depositShop').innerHTML = '<option value="">Select shop</option>' + shops.map(shop => '<option value="' + Number(shop.id) + '">' + esc(shop.name) + '</option>').join('');
            el('depositShop').value = shops.some(shop => String(shop.id) === selected) ? selected : shops.length === 1 ? shops[0].id : '';
            el('depositShop').disabled = !isAdmin();
            const filter = el('filterShop').value;
            el('filterShop').innerHTML = '<option value="">All shops</option>' + shops.map(shop => '<option value="' + Number(shop.id) + '">' + esc(shop.name) + '</option>').join('');
            el('filterShop').value = shops.some(shop => String(shop.id) === filter) ? filter : '';
            if (depositResult.status === 'rejected') throw depositResult.reason;
            const rows = depositResult.value;
            if (!rows) return;
            if (!Array.isArray(rows)) throw new Error('Unexpected deposit response.');
            records = rows; ready = true; render();
            if (!shops.length) message('A shop must be assigned before recording deposits.');
        } catch (err) {
            message('Could not refresh deposits: ' + err.message + ' Use Refresh to try again.' + (ready ? ' Previously loaded records are still shown.' : ''));
            if (!ready) {
                el('depositRows').innerHTML = '<tr><td colspan="7">Deposits could not be loaded. Use Refresh to retry.</td></tr>';
                el('depositShopTotals').innerHTML = '<tr><td colspan="3">Totals unavailable until deposits load.</td></tr>';
                el('depositTotal').textContent = 'Unavailable';
            }
        }
        finally { busy = false; controls(); }
    };
    const today = () => new Date().toISOString().slice(0, 10);
    el('depositDate').value = today(); el('depositDate').max = today();
    el('refreshDeposits').addEventListener('click', load);
    el('cancelDepositEdit').addEventListener('click', () => { if (!busy) { resetEditor(); message(''); } });
    el('filterShop').addEventListener('change', () => { if (ready) render(); });
    el('depositForm').addEventListener('submit', async event => {
        event.preventDefault();
        if (busy || !ready || !el('depositForm').reportValidity()) return;
        const file = el('bankReceipt').files[0];
        if ((!file && !editingId) || (file && file.size > 5 * 1024 * 1024)) { message('Select a bank receipt no larger than 5 MB.'); return; }
        busy = true; controls(); message('');
        try {
            const body = new FormData();
            body.append('amount', el('depositAmount').value);
            body.append('receipt_number', el('receiptNumber').value.trim());
            body.append('deposit_date', el('depositDate').value);
            body.append('shop_id', el('depositShop').value);
            if (file) body.append('receipt', file);
            const previous = records.find(row => row.id === editingId);
            const result = await apiFetch('/api/deposits' + (editingId ? '/' + editingId : ''), { method: editingId ? 'PUT' : 'POST', body });
            if (!result) return;
            const wasEditing = !!editingId;
            records = records.filter(row => Number(row.id) !== Number(result.id));
            records.unshift({ ...result, shop_name: shops.find(shop => Number(shop.id) === Number(result.shop_id))?.name, recorded_by: previous?.recorded_by || getCurrentUserName() });
            records.sort((a,b) => b.deposit_date.localeCompare(a.deposit_date) || b.id-a.id);
            el('depositAmount').value = ''; el('receiptNumber').value = ''; el('bankReceipt').value = '';
            el('depositDate').value = today(); el('depositDate').max = today();
            resetEditor();
            render(); message(wasEditing ? 'Deposit updated. Shop totals have been recalculated.' : 'Deposit and bank receipt recorded.');
        } catch (err) { message(err.message); }
        finally { busy = false; controls(); }
    });
    el('depositRows').addEventListener('click', async event => {
        const editButton = event.target.closest('[data-edit]');
        if (editButton) {
            if (busy) return;
            const row = records.find(item => Number(item.id) === Number(editButton.dataset.edit));
            if (!row) return;
            editingId = row.id;
            el('depositFormTitle').textContent = 'Edit bank deposit';
            el('saveDeposit').textContent = 'Save changes';
            el('cancelDepositEdit').hidden = false;
            el('receiptNumber').value = row.receipt_number;
            el('depositAmount').value = row.amount;
            el('depositDate').value = row.deposit_date;
            el('depositShop').value = row.shop_id;
            el('bankReceipt').value = ''; el('bankReceipt').required = false;
            el('existingReceipt').textContent = 'Current receipt: ' + (row.receipt_name || 'Bank receipt') + '. Leave the upload empty to keep it.';
            message('Editing deposit ' + row.receipt_number + '.');
            el('depositForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
            el('receiptNumber').focus();
            return;
        }
        const button = event.target.closest('[data-receipt]');
        if (!button) return;
        button.disabled = true;
        try {
            const response = await fetch(API_BASE + '/api/deposits/' + button.dataset.receipt + '/receipt', { headers: { Authorization: 'Bearer ' + getToken() } });
            if (response.status === 401) { clearToken(); window.location.href = 'index.html'; return; }
            if (!response.ok) throw new Error((await response.json()).error || 'Could not download receipt.');
            const url = URL.createObjectURL(await response.blob());
            const link = document.createElement('a'); link.href = url;
            link.download = 'bank-receipt.' + ({ 'application/pdf': 'pdf', 'image/png': 'png', 'image/jpeg': 'jpg' }[response.headers.get('Content-Type')?.split(';')[0]] || 'bin');
            document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 10000);
        } catch (err) { message(err.message); }
        finally { button.disabled = false; }
    });
    if (!['Admin', 'Manager'].includes(getCurrentUserRole())) {
        message('Deposits are available to managers and administrators.');
        el('depositRows').innerHTML = '<tr><td colspan="7">Sign in as a manager or administrator to view deposits.</td></tr>';
        el('depositShopTotals').innerHTML = '<tr><td colspan="3">Deposit totals require manager or administrator access.</td></tr>';
        return;
    }
    await load();
});
