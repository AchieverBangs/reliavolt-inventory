// ===== STATE =====
let _products = [];
let _shops = [];
let editingProductId = null;
let currentFilter = 'all';
let searchQuery = '';
let shopFilterId = '';

// ===== RENDER =====
function renderInventoryStats() {
    const inStock  = _products.filter(p => p.quantity > LOW_STOCK_THRESHOLD).length;
    const lowStock = _products.filter(p => p.quantity > 0 && p.quantity <= LOW_STOCK_THRESHOLD).length;
    const outStock = _products.filter(p => p.quantity === 0).length;
    setEl('statTotal',    _products.length);
    setEl('statInStock',  inStock);
    setEl('statLowStock', lowStock);
    setEl('statOutStock', outStock);
}

function renderProductTable() {
    const tbody = document.getElementById('productTableBody');
    if (!tbody) return;

    let filtered = _products.filter(p => {
        const matchSearch = !searchQuery ||
            p.name.toLowerCase().includes(searchQuery) ||
            (p.brand    || '').toLowerCase().includes(searchQuery) ||
            (p.category || '').toLowerCase().includes(searchQuery);
        const matchFilter =
            currentFilter === 'all' ||
            (currentFilter === 'in'  && p.quantity > LOW_STOCK_THRESHOLD) ||
            (currentFilter === 'low' && p.quantity > 0 && p.quantity <= LOW_STOCK_THRESHOLD) ||
            (currentFilter === 'out' && p.quantity === 0);
        const matchShop = !shopFilterId || p.shop_id === parseInt(shopFilterId);
        return matchSearch && matchFilter && matchShop;
    });

    const admin = isAdmin();
    const colspan = admin ? 10 : 6;
    if (!filtered.length) {
        tbody.innerHTML = `<tr><td colspan="${colspan}">
            <div class="empty-state"><span class="empty-icon">📦</span><p>No products found.</p></div>
        </td></tr>`;
        setEl('paginationInfo', 'Showing 0 products');
        return;
    }

    tbody.innerHTML = filtered.map((p, idx) => {
        const status = getStockStatus(p.quantity);
        // cost_price/profit are stripped server-side for non-admins, so this cell only ever renders for Admin
        const profit = p.selling_price - p.cost_price;
        const margin = p.selling_price > 0 ? ((profit / p.selling_price) * 100).toFixed(1) : '0.0';
        const shopCell   = admin ? `<td><span class="badge badge-secondary">${escHtml(p.shop_name || '—')}</span></td>` : '';
        const costCell   = admin ? `<td class="price-cell">${formatCurrency(p.cost_price)}</td>` : '';
        const profitCell = admin ? `<td class="profit-cell">+${formatCurrency(profit)} <span style="font-size:0.75rem;color:var(--text-light)">(${margin}%)</span></td>` : '';
        const actionsCell = admin ? `<td>
                <div class="action-cell">
                    <button class="btn btn-warning btn-sm" onclick="openEditProduct(${p.id})">✏️ Edit</button>
                    <button class="btn btn-danger btn-sm"  onclick="deleteProduct(${p.id})">🗑️ Delete</button>
                </div>
            </td>` : '';
        return `<tr class="${status.rowCls}">
            <td>${idx + 1}</td>
            <td>
                <div class="product-img-cell">
                    <div class="product-thumb">${p.icon || '📦'}</div>
                    <div class="product-name-cell">
                        <div class="pname">${escHtml(p.name)}</div>
                        <div class="pbrand">${escHtml(p.brand || '')}</div>
                    </div>
                </div>
            </td>
            <td><span class="badge badge-info">${escHtml(p.category || '')}</span></td>
            ${shopCell}
            ${costCell}
            <td class="price-cell">${formatCurrency(p.selling_price)}</td>
            ${profitCell}
            <td class="qty-cell">${p.quantity}</td>
            <td><span class="badge ${status.cls}">${status.label}</span></td>
            ${actionsCell}
        </tr>`;
    }).join('');

    setEl('paginationInfo', `Showing ${filtered.length} of ${_products.length} products`);
}

// ===== SHOP DROPDOWNS =====
function populateShopFilter() {
    const select = document.getElementById('shopFilter');
    if (!select) return;
    select.innerHTML = '<option value="">All Shops</option>' +
        _shops.map(s => `<option value="${s.id}">${escHtml(s.name)}</option>`).join('');
}

function populateProductShopSelect(selectId = 'productShop') {
    const select = document.getElementById(selectId);
    if (!select) return;
    const active = _shops.filter(s => s.status !== 'Inactive');
    select.innerHTML = '<option value="">-- Select Shop --</option>' +
        active.map(s => `<option value="${s.id}">${escHtml(s.name)}</option>`).join('');
}

// ===== ADD / EDIT =====
function openAddProduct() {
    editingProductId = null;
    document.getElementById('productForm').reset();
    document.getElementById('modalTitle').textContent = 'Add New Product';
    document.getElementById('productIcon').value = '📦';
    if (isAdmin()) populateProductShopSelect();
    clearPricePreview();
    openModal('productModal');
}

function openEditProduct(id) {
    const product = _products.find(p => p.id === id);
    if (!product) return;

    editingProductId = id;
    document.getElementById('modalTitle').textContent     = 'Edit Product';
    document.getElementById('productName').value          = product.name;
    document.getElementById('productCategory').value      = product.category || '';
    document.getElementById('productBrand').value         = product.brand    || '';
    document.getElementById('productCost').value          = product.cost_price;
    document.getElementById('productSelling').value       = product.selling_price;
    document.getElementById('productQuantity').value      = product.quantity;
    document.getElementById('productIcon').value          = product.icon || '📦';

    if (isAdmin()) {
        populateProductShopSelect();
        document.getElementById('productShop').value = product.shop_id || '';
    }

    updatePricePreview();
    openModal('productModal');
}

async function saveProduct() {
    const name          = document.getElementById('productName').value.trim();
    const category      = document.getElementById('productCategory').value.trim();
    const brand         = document.getElementById('productBrand').value.trim();
    const selling_price = parseFloat(document.getElementById('productSelling').value);
    const quantity      = parseInt(document.getElementById('productQuantity').value);
    const icon          = document.getElementById('productIcon').value.trim() || '📦';

    if (!name || !category || !brand || isNaN(selling_price) || isNaN(quantity)) {
        showToast('Please fill in all required fields.', 'error');
        return;
    }
    if (quantity < 0) { showToast('Quantity cannot be negative.', 'error'); return; }

    const payload = { name, category, brand, selling_price, quantity, icon };

    // Cost price and shop assignment are Admin-only fields
    if (isAdmin()) {
        const cost_price = parseFloat(document.getElementById('productCost').value) || 0;
        if (selling_price <= cost_price) { showToast('Selling price must be greater than cost price.', 'warning'); return; }
        payload.cost_price = cost_price;

        const shopId = document.getElementById('productShop')?.value;
        if (!shopId) { showToast('Please select a shop.', 'error'); return; }
        payload.shop_id = parseInt(shopId);
    }

    try {
        if (editingProductId) {
            const updated = await api.put(`/api/products/${editingProductId}`, payload);
            const idx = _products.findIndex(p => p.id === editingProductId);
            if (idx !== -1) _products[idx] = updated;
            showToast(`${name} updated successfully.`, 'success');
        } else {
            const created = await api.post('/api/products', payload);
            _products.push(created);
            showToast(`${name} added to inventory.`, 'success');
        }
        closeModal('productModal');
        renderInventoryStats();
        renderProductTable();
        populateCategoryFilter();
    } catch (err) {
        showToast(err.message, 'error');
    }
}

async function deleteProduct(id) {
    const product = _products.find(p => p.id === id);
    if (!product) return;

    showConfirm('Delete Product', `Are you sure you want to delete "${product.name}"? This cannot be undone.`, async () => {
        try {
            await api.delete(`/api/products/${id}`);
            _products = _products.filter(p => p.id !== id);
            showToast(`${product.name} deleted.`, 'warning');
            renderInventoryStats();
            renderProductTable();
            populateCategoryFilter();
        } catch (err) {
            showToast(err.message, 'error');
        }
    });
}

// ===== PRICE PREVIEW =====
function updatePricePreview() {
    const cost    = parseFloat(document.getElementById('productCost').value)    || 0;
    const selling = parseFloat(document.getElementById('productSelling').value) || 0;
    const profit  = selling - cost;
    const margin  = selling > 0 ? ((profit / selling) * 100).toFixed(1) : 0;

    setEl('previewCost',    formatCurrency(cost));
    setEl('previewSelling', formatCurrency(selling));
    setEl('previewProfit',  `${formatCurrency(profit)} (${margin}%)`);

    const profitEl = document.getElementById('previewProfit');
    if (profitEl) profitEl.style.color = profit > 0 ? '#16a34a' : profit < 0 ? '#dc2626' : 'inherit';
}

function clearPricePreview() {
    const c = localStorage.getItem('rv_currency') || 'Le';
    setEl('previewCost',    `${c} 0`);
    setEl('previewSelling', `${c} 0`);
    setEl('previewProfit',  `${c} 0 (0%)`);
}

// ===== IMPORT (Excel/CSV) =====
function openImportModal() {
    document.getElementById('importFile').value = '';
    const resultEl = document.getElementById('importResult');
    resultEl.style.display = 'none';
    resultEl.innerHTML = '';
    if (isAdmin()) populateProductShopSelect('importShop');
    openModal('importModal');
}

async function runImport() {
    const file = document.getElementById('importFile').files[0];
    if (!file) { showToast('Please choose a file to upload.', 'error'); return; }

    const formData = new FormData();
    formData.append('file', file);

    if (isAdmin()) {
        const shopId = document.getElementById('importShop')?.value;
        if (!shopId) { showToast('Please select a shop.', 'error'); return; }
        formData.append('shop_id', shopId);
    }

    const btn = document.getElementById('runImportBtn');
    btn.disabled = true;
    btn.textContent = 'Importing…';

    try {
        const result = await api.upload('/api/products/import', formData);
        const resultEl = document.getElementById('importResult');
        resultEl.style.display = 'block';
        resultEl.innerHTML = `<div style="color:#16a34a;font-weight:600;">✅ Imported ${result.imported} of ${result.total} row(s).</div>` +
            (result.skipped.length ? `<div style="margin-top:0.5rem;color:#dc2626;">Skipped ${result.skipped.length} row(s):
                <ul style="margin:0.25rem 0 0 1.2rem;">${result.skipped.map(s => `<li>Row ${s.row}: ${escHtml(s.reason)}</li>`).join('')}</ul></div>` : '');
        showToast(`Imported ${result.imported} product(s).`, 'success');

        _products = await api.get('/api/products');
        renderInventoryStats();
        renderProductTable();
        populateCategoryFilter();
    } catch (err) {
        showToast(err.message, 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Upload & Import';
    }
}

// ===== CATEGORY DROPDOWN =====
function populateCategoryFilter() {
    const categories = [...new Set(_products.map(p => p.category).filter(Boolean))].sort();
    const select = document.getElementById('categoryFilter');
    if (!select) return;
    const current = select.value;
    select.innerHTML = '<option value="">All Categories</option>' +
        categories.map(c => `<option value="${c}"${c === current ? ' selected' : ''}>${c}</option>`).join('');
}

// ===== HELPERS =====
function setEl(id, val) { const el = document.getElementById(id); if (el) el.textContent = val; }

function escHtml(str) {
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ===== INIT =====
document.addEventListener('DOMContentLoaded', async () => {
    const hashFilter = window.location.hash.slice(1);
    if (['all', 'in', 'low', 'out'].includes(hashFilter)) currentFilter = hashFilter;

    try {
        [_products, _shops] = await Promise.all([
            api.get('/api/products'),
            api.get('/api/shops'),
        ]);
    } catch (err) {
        showToast('Failed to load inventory: ' + err.message, 'error');
        _products = []; _shops = [];
    }

    renderInventoryStats();
    renderProductTable();
    populateCategoryFilter();
    if (isAdmin()) populateShopFilter();

    if (hashFilter && ['all', 'in', 'low', 'out'].includes(hashFilter)) {
        document.querySelectorAll('[data-stock-filter]').forEach(b => b.classList.remove('active'));
        document.querySelector(`[data-stock-filter="${hashFilter}"]`)?.classList.add('active');
        document.querySelector(`[data-stock-filter="${hashFilter}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    document.getElementById('searchProduct')?.addEventListener('input', (e) => {
        searchQuery = e.target.value.toLowerCase().trim();
        renderProductTable();
    });

    document.querySelectorAll('[data-stock-filter]').forEach(btn => {
        btn.addEventListener('click', () => {
            currentFilter = btn.dataset.stockFilter;
            document.querySelectorAll('[data-stock-filter]').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            renderProductTable();
        });
    });

    const catFilter = document.getElementById('categoryFilter');
    catFilter && catFilter.addEventListener('change', () => {
        searchQuery = catFilter.value.toLowerCase();
        renderProductTable();
    });

    const shopFilter = document.getElementById('shopFilter');
    shopFilter && shopFilter.addEventListener('change', () => {
        shopFilterId = shopFilter.value;
        renderProductTable();
    });

    ['productCost', 'productSelling'].forEach(id => {
        document.getElementById(id)?.addEventListener('input', updatePricePreview);
    });

    document.getElementById('addProductBtn')?.addEventListener('click', openAddProduct);
    document.getElementById('saveProductBtn')?.addEventListener('click', saveProduct);
    document.getElementById('importProductsBtn')?.addEventListener('click', openImportModal);
    document.getElementById('runImportBtn')?.addEventListener('click', runImport);
});
