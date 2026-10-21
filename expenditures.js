function escHtml(value) {
    const span = document.createElement('span');
    span.textContent = String(value ?? '');
    return span.innerHTML;
}

let expenditureRecords = [];
document.addEventListener('DOMContentLoaded', async () => {
    const el = id => document.getElementById(id);
    let availableShops = [];
    let ready = false;
    let busy = false;
    const message = text => { el('expenseMessage').textContent = text; };
    const errorMessage = err => /Route\s+\w+\s+\/api\/|HTTP 404/i.test(err.message)
        ? 'The server needs the expenditure update before records can be loaded or saved.'
        : err.message;
    const updateControls = () => {
        el('saveExpenditure').disabled = busy || !ready || !availableShops.length;
        el('refreshExpenses').disabled = busy;
    };
    const render = () => {
        const from = el('filterFrom').value;
        const to = el('filterTo').value;
        if (from && to && from > to) {
            message('From date must be before To date.');
            return;
        }
        const rows = expenditureRecords.filter(row =>
            (!from || row.expense_date.slice(0, 10) >= from) &&
            (!to || row.expense_date.slice(0, 10) <= to));
        const cents = rows.reduce((sum, row) => sum + Math.round(Number(row.amount) * 100), 0);
        el('expenseTotal').textContent = formatCurrency(cents / 100);
        el('expenseRows').innerHTML = rows.length ? rows.map(row =>
            '<tr><td>' + escHtml(row.expense_date.slice(0, 10)) + '</td><td>' +
            escHtml(row.description) + '</td><td>' + escHtml(row.category) + '</td><td>' +
            escHtml(row.shop_name || 'Unassigned') + '</td><td>' +
            escHtml(formatCurrency(row.amount)) + '</td><td>' +
            escHtml(row.recorded_by || 'Unknown') + '</td></tr>').join('') :
            '<tr><td colspan="6">No expenditure recorded for these dates.</td></tr>';
    };
    const load = async () => {
        if (busy) return;
        busy = true;
        updateControls();
        message('');
        try {
            // Reload both dependencies so Refresh also recovers an initial failure.
            const [shops, rows] = await Promise.all([
                api.get('/api/shops'), api.get('/api/expenditures')
            ]);
            if (!shops || !rows) return; // apiFetch redirects expired sessions to sign-in.
            if (!Array.isArray(shops) || !Array.isArray(rows)) throw new Error('Unexpected server response.');
            const selectedShop = el('expenseShop').value;
            availableShops = isAdmin() ? shops : shops.filter(shop =>
                Number(shop.id) === Number(getCurrentUserShopId()));
            el('expenseShop').innerHTML = '<option value="">Select shop</option>' +
                availableShops.map(shop => '<option value="' + Number(shop.id) + '">' +
                    escHtml(shop.name) + '</option>').join('');
            if (availableShops.some(shop => String(shop.id) === selectedShop)) {
                el('expenseShop').value = selectedShop;
            } else if (availableShops.length === 1) {
                el('expenseShop').value = availableShops[0].id;
            }
            el('expenseShop').disabled = !isAdmin();
            expenditureRecords = rows;
            ready = true;
            render();
            if (!availableShops.length) message('A shop must be assigned before you can record expenditure.');
        } catch (err) {
            message(errorMessage(err));
            if (!ready) {
                el('expenseRows').innerHTML = '<tr><td colspan="6">Records have not been loaded.</td></tr>';
                el('expenseTotal').textContent = '—';
            }
        } finally {
            busy = false;
            updateControls();
        }
    };
    el('expenseDate').value = todayStr();
    for (const id of ['filterFrom', 'filterTo']) {
        el(id).addEventListener('change', () => { message(''); if (ready) render(); });
    }
    el('refreshExpenses').addEventListener('click', load);
    el('expenditureForm').addEventListener('submit', async event => {
        event.preventDefault();
        if (busy || !ready || !availableShops.length) return;
        if (!el('expenditureForm').reportValidity()) return;
        busy = true;
        updateControls();
        message('');
        try {
            const result = await api.post('/api/expenditures', {
                expense_date: el('expenseDate').value,
                shop_id: Number(el('expenseShop').value),
                description: el('expenseDescription').value.trim(),
                category: el('expenseCategory').value.trim(),
                amount: el('expenseAmount').value
            });
            if (!result) return;
            // A confirmed save should appear immediately, without another network request.
            const shop = availableShops.find(item => Number(item.id) === Number(result.shop_id));
            const saved = { ...result, shop_name: shop?.name, recorded_by: getCurrentUserName() };
            expenditureRecords = [saved, ...expenditureRecords.filter(row => row.id !== result.id)]
                .sort((a, b) => b.expense_date.localeCompare(a.expense_date) || b.id - a.id);
            el('expenseDescription').value = '';
            el('expenseAmount').value = '';
            render();
            message('Expenditure recorded.');
        } catch (err) {
            message(errorMessage(err));
        } finally {
            busy = false;
            updateControls();
        }
    });
    await load();
});
