// ===== STATE =====
let _customers = [];
let _sales     = [];

// ===== RENDER CUSTOMERS =====
function renderCustomers(filter = '') {
    const tbody = document.getElementById('customerTableBody');
    if (!tbody) return;

    const filtered = _customers.filter(c =>
        !filter ||
        c.name.toLowerCase().includes(filter) ||
        (c.phone || '').includes(filter) ||
        (c.address || '').toLowerCase().includes(filter)
    );

    setEl('customerCount', `${filtered.length} customers`);

    if (!filtered.length) {
        tbody.innerHTML = `<tr><td colspan="6">
            <div class="empty-state"><span class="empty-icon">👥</span><p>No customers found.</p></div>
        </td></tr>`;
        return;
    }

    tbody.innerHTML = filtered.map((c, idx) => {
        const custSales  = _sales.filter(s => s.customer_id === c.id || s.customer_name === c.name);
        const totalSpent = custSales.reduce((sum, s) => sum + Number(s.total), 0);

        return `<tr>
            <td>${idx + 1}</td>
            <td>
                <div class="cust-row-name">
                    <div class="sale-avatar">${c.name.charAt(0)}</div>
                    <div>
                        <div class="cust-name-text">${escHtml(c.name)}</div>
                        <div class="cust-joined-text">Since ${formatDate(c.joined_at)}</div>
                    </div>
                </div>
            </td>
            <td>${escHtml(c.phone || '—')}</td>
            <td>${escHtml(c.address || '—')}</td>
            <td>
                <div class="cust-spent-primary">${formatCurrency(totalSpent)}</div>
                <div class="cust-spent-sub">${custSales.length} purchase${custSales.length !== 1 ? 's' : ''}</div>
            </td>
            <td>
                <div class="action-cell">
                    <button class="btn btn-primary btn-sm" onclick="viewHistory(${c.id})">📋 History</button>
                    <button class="btn btn-danger btn-sm"  onclick="deleteCustomer(${c.id})">🗑️</button>
                </div>
            </td>
        </tr>`;
    }).join('');
}

// ===== ADD CUSTOMER =====
async function addCustomer() {
    const name    = document.getElementById('custName').value.trim();
    const phone   = document.getElementById('custPhone').value.trim();
    const address = document.getElementById('custAddress').value.trim();

    if (!name || !phone) { showToast('Name and phone number are required.', 'error'); return; }

    const duplicate = _customers.find(c => c.phone === phone);
    if (duplicate) { showToast('A customer with this phone number already exists.', 'warning'); return; }

    try {
        const created = await api.post('/api/customers', { name, phone, address: address || '—' });
        _customers.push(created);
        showToast(`${name} added as a customer.`, 'success');
        closeModal('addCustomerModal');
        document.getElementById('customerForm').reset();
        renderCustomers();
        updateCustomerSummary();
    } catch (err) {
        showToast(err.message, 'error');
    }
}

// ===== DELETE CUSTOMER =====
async function deleteCustomer(id) {
    const customer = _customers.find(c => c.id === id);
    if (!customer) return;

    showConfirm('Delete Customer', `Remove "${customer.name}" from your customers list?`, async () => {
        try {
            await api.delete(`/api/customers/${id}`);
            _customers = _customers.filter(c => c.id !== id);
            showToast(`${customer.name} removed.`, 'warning');
            renderCustomers();
            updateCustomerSummary();
        } catch (err) {
            showToast(err.message, 'error');
        }
    });
}

// ===== VIEW PURCHASE HISTORY =====
function viewHistory(id) {
    const customer = _customers.find(c => c.id === id);
    if (!customer) return;

    const sales  = _sales.filter(s => s.customer_id === id || s.customer_name === customer.name);
    const total  = sales.reduce((sum, s) => sum + Number(s.total), 0);

    document.getElementById('historyCustomerName').textContent = customer.name;
    document.getElementById('historyPhone').textContent        = customer.phone || '—';
    document.getElementById('historyAddress').textContent      = customer.address || '—';
    document.getElementById('historyTotalSpent').textContent   = formatCurrency(total);
    document.getElementById('historyCount').textContent        = `${sales.length} purchase${sales.length !== 1 ? 's' : ''}`;

    const tbody = document.getElementById('historyTableBody');
    if (!sales.length) {
        tbody.innerHTML = `<tr><td colspan="5">
            <div class="empty-state"><span class="empty-icon">🛒</span><p>No purchase history for this customer.</p></div>
        </td></tr>`;
    } else {
        tbody.innerHTML = sales.slice().reverse().map(s => `<tr>
            <td><strong>${escHtml(s.receipt_no)}</strong></td>
            <td>${escHtml(s.product_name)}</td>
            <td>${s.qty}</td>
            <td><strong>${formatCurrency(s.total)}</strong></td>
            <td>${formatDate(s.sale_date)}</td>
        </tr>`).join('');
    }

    openModal('historyModal');
}

// ===== SUMMARY =====
function updateCustomerSummary() {
    const totalSpent = _sales.reduce((sum, s) => sum + Number(s.total), 0);
    setEl('totalCustomers', _customers.length);
    setEl('totalRevenue',   formatCurrency(totalSpent));

    const thisMonth = _sales.filter(s => isSameMonth(s.sale_date));
    setEl('monthlyCustomers', new Set(thisMonth.map(s => s.customer_name)).size);
}

// ===== HELPERS =====
function setEl(id, val) { const el = document.getElementById(id); if (el) el.textContent = val; }

function escHtml(str) {
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ===== INIT =====
document.addEventListener('DOMContentLoaded', async () => {
    try {
        [_customers, _sales] = await Promise.all([
            api.get('/api/customers'),
            api.get('/api/sales'),
        ]);
    } catch (err) {
        showToast('Failed to load customers: ' + err.message, 'error');
        _customers = []; _sales = [];
    }

    renderCustomers();
    updateCustomerSummary();

    document.getElementById('searchCustomer')?.addEventListener('input', (e) => {
        renderCustomers(e.target.value.toLowerCase().trim());
    });

    document.getElementById('addCustomerBtn')?.addEventListener('click', () => openModal('addCustomerModal'));
    document.getElementById('saveCustomerBtn')?.addEventListener('click', addCustomer);
});
