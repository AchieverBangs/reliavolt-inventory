// ===== STATE =====
let _creditCustomers = [];
let _activePaymentCustomerId = null;

// ===== RENDER =====
function renderCreditTable(filter = '') {
    const tbody = document.getElementById('creditTableBody');
    if (!tbody) return;

    const admin = isAdmin();
    const filtered = _creditCustomers.filter(c =>
        !filter ||
        c.name.toLowerCase().includes(filter) ||
        (c.phone || '').includes(filter)
    );

    if (!filtered.length) {
        tbody.innerHTML = `<tr><td colspan="${admin ? 5 : 4}">
            <div class="empty-state"><span class="empty-icon">📒</span><p>${_creditCustomers.length ? 'No matching customers.' : 'No one currently owes credit.'}</p></div>
        </td></tr>`;
        return;
    }

    tbody.innerHTML = filtered.map(c => `
        <tr>
            <td><strong>${escHtml(c.name)}</strong></td>
            <td>${escHtml(c.phone || '—')}</td>
            ${admin ? `<td><span class="badge badge-secondary">${escHtml(c.shop_name || '—')}</span></td>` : ''}
            <td><strong style="color:#dc2626;">${formatCurrency(c.credit_balance)}</strong></td>
            <td>
                <div class="action-cell">
                    <button class="btn btn-success btn-sm" onclick="openPaymentModal(${c.id})">💵 Record Payment</button>
                    <button class="btn btn-secondary btn-sm" onclick="openCreditHistory(${c.id})">📋 History</button>
                </div>
            </td>
        </tr>`).join('');
}

function updateCreditSummary() {
    setEl('totalOwingCount', _creditCustomers.length);
    const total = _creditCustomers.reduce((sum, c) => sum + Number(c.credit_balance), 0);
    setEl('totalOutstanding', formatCurrency(total));
}

async function reloadCreditCustomers() {
    try {
        _creditCustomers = await api.get('/api/customers/credit');
    } catch (err) {
        showToast('Failed to load credit customers: ' + err.message, 'error');
        _creditCustomers = [];
    }
    renderCreditTable(document.getElementById('searchCreditCustomer')?.value.toLowerCase().trim() || '');
    updateCreditSummary();
}

// ===== RECORD PAYMENT =====
function openPaymentModal(id) {
    const customer = _creditCustomers.find(c => c.id === id);
    if (!customer) return;

    _activePaymentCustomerId = id;
    setEl('paymentCustomerName', customer.name);
    setEl('paymentCurrentBalance', formatCurrency(customer.credit_balance));

    const amountInput = document.getElementById('paymentAmount');
    if (amountInput) { amountInput.value = ''; amountInput.max = customer.credit_balance; }
    const dateInput = document.getElementById('paymentDate');
    if (dateInput) dateInput.value = todayStr();
    const noteInput = document.getElementById('paymentNote');
    if (noteInput) noteInput.value = '';

    openModal('paymentModal');
}

async function savePayment() {
    if (!_activePaymentCustomerId) return;
    const customer = _creditCustomers.find(c => c.id === _activePaymentCustomerId);
    if (!customer) return;

    const amount = parseFloat(document.getElementById('paymentAmount').value);
    const paid_date = document.getElementById('paymentDate').value || undefined;
    const note = document.getElementById('paymentNote').value.trim() || undefined;

    if (!amount || amount <= 0) { showToast('Enter a valid payment amount.', 'error'); return; }
    if (amount > Number(customer.credit_balance)) {
        showToast(`Payment exceeds the balance owed (${formatCurrency(customer.credit_balance)}).`, 'error');
        return;
    }

    try {
        await api.post(`/api/customers/${_activePaymentCustomerId}/credit-payments`, { amount, note, paid_date });
        showToast(`Payment of ${formatCurrency(amount)} recorded for ${customer.name}.`, 'success');
        closeModal('paymentModal');
        reloadCreditCustomers();
    } catch (err) {
        showToast(err.message, 'error');
    }
}

// ===== HISTORY =====
async function openCreditHistory(id) {
    const customer = _creditCustomers.find(c => c.id === id);
    if (!customer) return;

    setEl('historyCustName', customer.name);
    setEl('historyCustBalance', formatCurrency(customer.credit_balance));
    const tbody = document.getElementById('creditHistoryBody');
    if (tbody) tbody.innerHTML = `<tr><td colspan="4">Loading...</td></tr>`;
    openModal('creditHistoryModal');

    try {
        const data = await api.get(`/api/customers/${id}/credit-history`);
        if (!tbody) return;
        if (!data.timeline.length) {
            tbody.innerHTML = `<tr><td colspan="4"><div class="empty-state"><span class="empty-icon">📒</span><p>No credit history.</p></div></td></tr>`;
            return;
        }
        tbody.innerHTML = data.timeline.map(entry => {
            if (entry.type === 'sale') {
                return `<tr>
                    <td>${formatDateTime(entry.at)}</td>
                    <td><span class="badge badge-warning">Credit Sale</span></td>
                    <td>${escHtml(entry.product_name)} &times; ${entry.qty} <span style="color:var(--text-light);">(${escHtml(entry.receipt_no)})</span></td>
                    <td style="color:#dc2626;">+${formatCurrency(entry.amount)}</td>
                </tr>`;
            }
            return `<tr>
                <td>${formatDateTime(entry.at)}</td>
                <td><span class="badge badge-success">Payment</span></td>
                <td>${escHtml(entry.note || '—')} <span style="color:var(--text-light);">by ${escHtml(entry.recorded_by || 'Unknown')}</span></td>
                <td style="color:#16a34a;">&minus;${formatCurrency(entry.amount)}</td>
            </tr>`;
        }).join('');
    } catch (err) {
        if (tbody) tbody.innerHTML = `<tr><td colspan="4">Failed to load history: ${escHtml(err.message)}</td></tr>`;
    }
}

// ===== HELPERS =====
function setEl(id, val) { const el = document.getElementById(id); if (el) el.textContent = val; }

function escHtml(str) {
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ===== INIT =====
document.addEventListener('DOMContentLoaded', async () => {
    await reloadCreditCustomers();

    document.getElementById('searchCreditCustomer')?.addEventListener('input', (e) => {
        renderCreditTable(e.target.value.toLowerCase().trim());
    });
    document.getElementById('savePaymentBtn')?.addEventListener('click', savePayment);
});
