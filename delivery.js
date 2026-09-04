// ===== STATE =====
let _deliveries = [];
let _shops      = [];
let _products   = [];
let _customers  = [];
let deliveryProducts = [];
let searchQuery  = '';
let statusFilter = '';
let typeFilter   = '';

// ===== STATUS HELPERS =====
function statusBadgeClass(status) {
    const map = { 'Pending': 'status-pending', 'In Transit': 'status-transit', 'Delivered': 'status-delivered', 'Cancelled': 'status-cancelled' };
    return `badge ${map[status] || 'badge-secondary'}`;
}

function typeBadgeClass(type) {
    return `badge ${type === 'Customer Delivery' ? 'dlv-type-customer' : 'dlv-type-transfer'}`;
}

// ===== STAT CARD ACTIVE STATE =====
function setActiveStatCard(filter) {
    document.querySelectorAll('.dlv-stat-link').forEach(card => {
        card.classList.toggle('dlv-stat-active', card.dataset.filter === filter);
    });
}

// ===== DRIVER STATUS ACTIONS =====
function driverStatusActions(id, status) {
    if (status === 'Pending') {
        return `<div class="action-cell">
            <span class="badge status-pending">Pending</span>
            <button class="btn btn-warning btn-sm" onclick="confirmDeliveryStatus(${id},'In Transit')">🚛 Start</button>
        </div>`;
    }
    if (status === 'In Transit') {
        return `<div class="action-cell">
            <span class="badge status-transit">In Transit</span>
            <button class="btn btn-success btn-sm" onclick="confirmDeliveryStatus(${id},'Delivered')">✅ Delivered</button>
        </div>`;
    }
    return `<span class="badge ${status === 'Delivered' ? 'status-delivered' : 'status-cancelled'}">${escHtml(status)}</span>`;
}

function confirmDeliveryStatus(id, newStatus) {
    const label = newStatus === 'In Transit' ? 'start this delivery?' : 'mark this delivery as Delivered?';
    showConfirm('Confirm Status', `Are you sure you want to ${label}`, () => {
        updateDeliveryStatus(id, newStatus);
    });
}

// ===== RENDER STATS =====
function renderDeliveryStats() {
    setEl('dlvTotal',     _deliveries.length);
    setEl('dlvPending',   _deliveries.filter(d => d.status === 'Pending').length);
    setEl('dlvTransit',   _deliveries.filter(d => d.status === 'In Transit').length);
    setEl('dlvDelivered', _deliveries.filter(d => d.status === 'Delivered').length);
}

// ===== RENDER TABLE =====
function renderDeliveryTable() {
    const tbody = document.getElementById('deliveryTableBody');
    if (!tbody) return;

    let filtered = _deliveries.filter(d => {
        const matchSearch = !searchQuery ||
            (d.delivery_no || '').toLowerCase().includes(searchQuery) ||
            (d.to_name     || '').toLowerCase().includes(searchQuery) ||
            (d.driver      || '').toLowerCase().includes(searchQuery);
        const matchStatus = !statusFilter || d.status === statusFilter;
        const matchType   = !typeFilter   || d.type   === typeFilter;
        return matchSearch && matchStatus && matchType;
    });

    if (!filtered.length) {
        tbody.innerHTML = `<tr><td colspan="10"><div class="empty-state"><span class="empty-icon">🚚</span><p>No deliveries found.</p></div></td></tr>`;
        return;
    }

    const isDriver = getCurrentUserRole() === 'Delivery Person';

    tbody.innerHTML = filtered.map(d => {
        const fromShop = _shops.find(s => s.id === d.from_shop_id);
        const products = Array.isArray(d.products) ? d.products : [];
        const productSummary = products.map(p => `${p.product_name} (x${p.qty})`).join(', ');
        const shortProducts  = productSummary.length > 40 ? productSummary.substring(0, 40) + '…' : productSummary;

        const statusCell = isDriver
            ? driverStatusActions(d.id, d.status)
            : `<select class="status-select" onchange="updateDeliveryStatus(${d.id}, this.value)">
                <option${d.status === 'Pending'    ? ' selected' : ''}>Pending</option>
                <option${d.status === 'In Transit' ? ' selected' : ''}>In Transit</option>
                <option${d.status === 'Delivered'  ? ' selected' : ''}>Delivered</option>
                <option${d.status === 'Cancelled'  ? ' selected' : ''}>Cancelled</option>
               </select>`;

        const actionCell = isDriver
            ? `<button class="btn btn-primary btn-sm" onclick="viewDelivery(${d.id})">👁️ View</button>`
            : `<div class="action-cell">
                <button class="btn btn-primary btn-sm" onclick="viewDelivery(${d.id})">👁️ View</button>
                <button class="btn btn-danger btn-sm"  onclick="deleteDelivery(${d.id})">🗑️</button>
               </div>`;

        return `<tr>
            <td><strong>${escHtml(d.delivery_no)}</strong></td>
            <td><span class="${typeBadgeClass(d.type)}">${escHtml(d.type === 'Customer Delivery' ? '📦 Customer' : '🔄 Transfer')}</span></td>
            <td>${fromShop ? escHtml(fromShop.name) : '—'}</td>
            <td>
                <div style="font-weight:600;font-size:0.875rem;">${escHtml(d.to_name)}</div>
                ${d.to_address ? `<div style="font-size:0.75rem;color:var(--text-light);">${escHtml(d.to_address)}</div>` : ''}
            </td>
            <td style="font-size:0.82rem;max-width:180px;">${escHtml(shortProducts || '—')}</td>
            <td><strong>${formatCurrency(d.total)}</strong></td>
            <td style="font-size:0.82rem;">${escHtml(d.driver || '—')}</td>
            <td style="font-size:0.82rem;">${formatDate(d.delivery_date)}</td>
            <td>${statusCell}</td>
            <td>${actionCell}</td>
        </tr>`;
    }).join('');
}

// ===== UPDATE STATUS =====
async function updateDeliveryStatus(id, newStatus) {
    try {
        const updated = await api.patch(`/api/deliveries/${id}/status`, { status: newStatus });
        const idx = _deliveries.findIndex(d => d.id === id);
        if (idx !== -1) _deliveries[idx].status = newStatus;
        renderDeliveryStats();
        renderDeliveryTable();
        showToast(`Delivery ${updated.delivery_no || ''} → ${newStatus}`, 'success');
    } catch (err) {
        showToast(err.message, 'error');
    }
}

// ===== VIEW DELIVERY =====
function viewDelivery(id) {
    const d = _deliveries.find(dlv => dlv.id === id);
    if (!d) return;

    const fromShop   = _shops.find(s => s.id === d.from_shop_id);
    const companyName = localStorage.getItem('rv_company_name') || 'Reliavolt Supply';
    const products    = Array.isArray(d.products) ? d.products : [];

    document.getElementById('detailDeliveryNo').textContent = d.delivery_no;
    document.getElementById('deliveryDetailBody').innerHTML = `
        <div style="border:1px dashed var(--border);border-radius:var(--radius);padding:1.25rem;font-family:'Courier New',monospace;font-size:0.82rem;">
            <div style="text-align:center;margin-bottom:1rem;padding-bottom:0.75rem;border-bottom:1px dashed #ccc;">
                <img src="images/logo.svg" alt="RS" style="width:54px;height:54px;object-fit:contain;display:block;margin:0 auto 0.3rem;">
                <strong style="font-size:1rem;display:block;">${escHtml(companyName)}</strong>
                <span style="font-size:0.75rem;color:#666;">"We Go For Value"</span>
                <div style="margin-top:0.4rem;font-weight:bold;">DELIVERY NOTE</div>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem;margin-bottom:0.875rem;">
                <div><div style="color:#555;font-size:0.75rem;">Delivery No</div><div style="font-weight:bold;">${escHtml(d.delivery_no)}</div></div>
                <div><div style="color:#555;font-size:0.75rem;">Date</div><div>${formatDateTime(d.delivery_date)}</div></div>
                <div><div style="color:#555;font-size:0.75rem;">Type</div><div>${escHtml(d.type)}</div></div>
                <div><div style="color:#555;font-size:0.75rem;">Status</div><div><span class="${statusBadgeClass(d.status)}">${d.status}</span></div></div>
                <div><div style="color:#555;font-size:0.75rem;">From</div><div>${fromShop ? escHtml(fromShop.name) : '—'}</div></div>
                <div><div style="color:#555;font-size:0.75rem;">Driver</div><div>${escHtml(d.driver || 'Not Assigned')}</div></div>
            </div>
            <div style="border-top:1px dashed #ccc;padding-top:0.75rem;margin-bottom:0.75rem;">
                <div style="color:#555;font-size:0.75rem;">Deliver To</div>
                <div style="font-weight:bold;">${escHtml(d.to_name)}</div>
                ${d.to_address ? `<div>${escHtml(d.to_address)}</div>` : ''}
                ${d.phone      ? `<div>${escHtml(d.phone)}</div>`      : ''}
            </div>
            <div style="border-top:1px dashed #ccc;padding-top:0.75rem;">
                <div style="font-weight:bold;margin-bottom:0.5rem;">Items:</div>
                ${products.map(p => `
                    <div style="display:flex;justify-content:space-between;padding:0.25rem 0;">
                        <span>${escHtml(p.product_name)}</span>
                        <span>x${p.qty} @ ${formatCurrency(p.price)} = <strong>${formatCurrency(p.price * p.qty)}</strong></span>
                    </div>`).join('')}
                <div style="border-top:1px dashed #ccc;margin-top:0.5rem;padding-top:0.5rem;display:flex;justify-content:space-between;font-weight:bold;">
                    <span>TOTAL VALUE</span>
                    <span>${formatCurrency(d.total)}</span>
                </div>
            </div>
            ${d.notes ? `<div style="margin-top:0.75rem;padding-top:0.75rem;border-top:1px dashed #ccc;font-size:0.75rem;color:#555;">Notes: ${escHtml(d.notes)}</div>` : ''}
            <div style="text-align:center;margin-top:1rem;padding-top:0.75rem;border-top:1px dashed #ccc;font-size:0.75rem;color:#666;">
                Receiver Signature: ______________________ &nbsp;&nbsp; Date: ____________
            </div>
        </div>`;

    document.getElementById('printDeliveryBtn').onclick = () => window.print();
    openModal('deliveryDetailModal');
}

// ===== DELETE DELIVERY =====
async function deleteDelivery(id) {
    const d = _deliveries.find(dlv => dlv.id === id);
    if (!d) return;

    showConfirm('Delete Delivery', `Remove delivery record ${d.delivery_no}?`, async () => {
        try {
            await api.delete(`/api/deliveries/${id}`);
            _deliveries = _deliveries.filter(dlv => dlv.id !== id);
            showToast(`${d.delivery_no} deleted.`, 'warning');
            renderDeliveryStats();
            renderDeliveryTable();
        } catch (err) {
            showToast(err.message, 'error');
        }
    });
}

// ===== PRODUCT ROWS =====
function renderDeliveryProductRows() {
    const container = document.getElementById('deliveryProductsList');
    if (!container) return;

    if (!deliveryProducts.length) deliveryProducts.push({ name: '', qty: 1, price: 0 });

    container.innerHTML = deliveryProducts.map((p, i) => `
        <div class="delivery-product-row">
            <div>
                <select class="form-control" id="dlvProduct_${i}" style="margin-bottom:0.4rem;">
                    <option value="">-- Select Product --</option>
                    ${_products.map(pr => `<option value="${escHtml(pr.name)}" data-price="${pr.selling_price}"${p.name === pr.name ? ' selected' : ''}>${escHtml(pr.name)}</option>`).join('')}
                </select>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.4rem;">
                    <input type="number" class="form-control" id="dlvQty_${i}"   value="${p.qty}"          min="1" placeholder="Qty">
                    <input type="number" class="form-control" id="dlvPrice_${i}" value="${p.price || ''}"  min="0" placeholder="Unit Price (Le)">
                </div>
            </div>
            <button class="product-remove-btn" onclick="removeProductRow(${i})">✕ Remove</button>
        </div>`).join('');

    deliveryProducts.forEach((_, i) => {
        const sel = document.getElementById(`dlvProduct_${i}`);
        sel && sel.addEventListener('change', () => {
            const opt   = sel.options[sel.selectedIndex];
            const price = opt ? parseFloat(opt.dataset.price || 0) : 0;
            const priceInput = document.getElementById(`dlvPrice_${i}`);
            if (priceInput && price) priceInput.value = price;
        });
    });
}

function addProductRow() {
    syncProductRowsFromDOM();
    deliveryProducts.push({ name: '', qty: 1, price: 0 });
    renderDeliveryProductRows();
}

function removeProductRow(idx) {
    syncProductRowsFromDOM();
    deliveryProducts.splice(idx, 1);
    if (!deliveryProducts.length) deliveryProducts.push({ name: '', qty: 1, price: 0 });
    renderDeliveryProductRows();
}

function syncProductRowsFromDOM() {
    deliveryProducts = deliveryProducts.map((_, i) => ({
        name:  (document.getElementById(`dlvProduct_${i}`)?.value || ''),
        qty:   parseInt(document.getElementById(`dlvQty_${i}`)?.value)   || 1,
        price: parseFloat(document.getElementById(`dlvPrice_${i}`)?.value) || 0,
    }));
}

// ===== POPULATE SHOP SELECTS =====
function populateShopSelects() {
    const activeShops  = _shops.filter(s => s.status === 'Active');
    const driverShopId = getCurrentUserShopId();

    const fromShops  = driverShopId ? activeShops.filter(s => s.id === driverShopId) : activeShops;
    const fromEl     = document.getElementById('fromShop');
    const toEl       = document.getElementById('toShop');

    if (fromEl) fromEl.innerHTML = '<option value="">-- Select Shop --</option>' +
        fromShops.map(s => `<option value="${s.id}">${escHtml(s.name)}</option>`).join('');
    if (toEl) toEl.innerHTML = '<option value="">-- Select Destination --</option>' +
        activeShops.map(s => `<option value="${s.id}">${escHtml(s.name)}</option>`).join('');

    const custList = document.getElementById('customerDeliveryList');
    if (custList) custList.innerHTML = _customers.map(c => `<option value="${escHtml(c.name)}">`).join('');
}

// ===== SAVE DELIVERY =====
async function saveDelivery() {
    syncProductRowsFromDOM();

    const type       = document.getElementById('deliveryType').value;
    const fromShopId = parseInt(document.getElementById('fromShop').value);
    const driverName = document.getElementById('driverName').value.trim();
    const notes      = document.getElementById('deliveryNotes').value.trim();

    if (!fromShopId) { showToast('Please select the source shop.', 'error'); return; }

    let toName = '', toAddress = '', toPhone = '', toShopId = null;

    if (type === 'Customer Delivery') {
        toName    = document.getElementById('toName').value.trim();
        toAddress = document.getElementById('toAddress').value.trim();
        toPhone   = document.getElementById('toPhone').value.trim();
        if (!toName || !toAddress) { showToast('Recipient name and address are required.', 'error'); return; }
    } else {
        const toShopVal = document.getElementById('toShop').value;
        if (!toShopVal) { showToast('Please select the destination shop.', 'error'); return; }
        toShopId  = parseInt(toShopVal);
        const toShop = _shops.find(s => s.id === toShopId);
        if (toShop) { toName = toShop.name; toAddress = toShop.address; }
        if (toShopId === fromShopId) { showToast('Source and destination shops must be different.', 'error'); return; }
    }

    const validProducts = deliveryProducts.filter(p => p.name && p.qty > 0);
    if (!validProducts.length) { showToast('Add at least one product.', 'error'); return; }

    try {
        const created = await api.post('/api/deliveries', {
            type:         type || 'Customer Delivery',
            from_shop_id: fromShopId,
            to_name:      toName,
            to_address:   toAddress,
            to_shop_id:   toShopId,
            phone:        toPhone || null,
            driver:       driverName || null,
            notes:        notes || null,
            products:     validProducts.map(p => ({ product_name: p.name, qty: p.qty, price: p.price })),
        });

        _deliveries.unshift(created);
        showToast(`Delivery ${created.delivery_no} created!`, 'success');
        closeModal('deliveryModal');
        deliveryProducts = [];
        renderDeliveryStats();
        renderDeliveryTable();
    } catch (err) {
        showToast(err.message, 'error');
    }
}

// ===== HELPERS =====
function setEl(id, val) { const el = document.getElementById(id); if (el) el.textContent = val; }

function escHtml(str) {
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ===== INIT =====
document.addEventListener('DOMContentLoaded', async () => {
    if (getCurrentUserRole() === 'Delivery Person') {
        const btn = document.getElementById('newDeliveryBtn');
        if (btn) btn.classList.add('hidden');
    }

    try {
        [_deliveries, _shops, _products, _customers] = await Promise.all([
            api.get('/api/deliveries'),
            api.get('/api/shops'),
            api.get('/api/products'),
            api.get('/api/customers'),
        ]);
    } catch (err) {
        showToast('Failed to load deliveries: ' + err.message, 'error');
        _deliveries = []; _shops = []; _products = []; _customers = [];
    }

    renderDeliveryStats();
    renderDeliveryTable();

    document.getElementById('searchDelivery')?.addEventListener('input', e => {
        searchQuery = e.target.value.toLowerCase().trim();
        renderDeliveryTable();
    });

    document.getElementById('statusFilter')?.addEventListener('change', e => {
        statusFilter = e.target.value;
        setActiveStatCard(statusFilter);
        renderDeliveryTable();
    });

    document.querySelectorAll('.dlv-stat-link').forEach(card => {
        card.addEventListener('click', () => {
            statusFilter = card.dataset.filter;
            const filterSelect = document.getElementById('statusFilter');
            if (filterSelect) filterSelect.value = statusFilter;
            setActiveStatCard(statusFilter);
            renderDeliveryTable();
            document.getElementById('deliveryTableBody')
                ?.closest('.card')
                ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
    });

    document.getElementById('typeFilter')?.addEventListener('change', e => {
        typeFilter = e.target.value;
        renderDeliveryTable();
    });

    document.getElementById('newDeliveryBtn')?.addEventListener('click', () => {
        deliveryProducts = [{ name: '', qty: 1, price: 0 }];
        document.getElementById('deliveryForm').reset();
        populateShopSelects();
        renderDeliveryProductRows();
        document.getElementById('customerFields')?.classList.remove('hidden');
        document.getElementById('shopTransferFields')?.classList.add('hidden');
        openModal('deliveryModal');
    });

    document.getElementById('deliveryType')?.addEventListener('change', e => {
        const isTransfer = e.target.value === 'Shop Transfer';
        document.getElementById('customerFields')?.classList.toggle('hidden', isTransfer);
        document.getElementById('shopTransferFields')?.classList.toggle('hidden', !isTransfer);
    });

    document.getElementById('addProductRowBtn')?.addEventListener('click', addProductRow);
    document.getElementById('saveDeliveryBtn')?.addEventListener('click', saveDelivery);
});
