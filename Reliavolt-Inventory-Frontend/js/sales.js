// ===== STATE =====
let _products  = [];
let _shops     = [];
let _customers = [];
let _sales     = [];
let _settings  = {};

let currentSale = {
    productId:     null,
    qty:           1,
    unitPrice:     0,
    unitCost:      0,
    paymentMethod: 'Cash',
    receiptNo:     '—',
};

// ===== POPULATE SHOP DROPDOWN =====
function populateShopSelect() {
    const select = document.getElementById('saleShop');
    if (!select) return;
    const active = _shops.filter(s => s.status === 'Active');
    select.innerHTML = '<option value="">-- Select Shop --</option>' +
        active.map(s => `<option value="${s.id}">${escHtml(s.name)}</option>`).join('');

    const shopId = getCurrentUserShopId();
    if (shopId) select.value = shopId;
}

// ===== POPULATE PRODUCT DROPDOWN =====
function populateProductSelect() {
    const select = document.getElementById('productSelect');
    if (!select) return;
    select.innerHTML = '<option value="">-- Select a Product --</option>' +
        _products.filter(p => p.quantity > 0).map(p => {
            const status = getStockStatus(p.quantity);
            return `<option value="${p.id}" data-cost="${p.cost_price}" data-price="${p.selling_price}" data-qty="${p.quantity}">
                ${escHtml(p.name)} (${escHtml(p.brand || '')}) - ${formatCurrency(p.selling_price)} [Qty: ${p.quantity}]
            </option>`;
        }).join('');
}

// ===== ON PRODUCT CHANGE =====
function onProductChange() {
    const select = document.getElementById('productSelect');
    const opt    = select.options[select.selectedIndex];

    if (!opt || !opt.value) {
        currentSale.productId  = null;
        currentSale.unitPrice  = 0;
        currentSale.unitCost   = 0;
        updateAmountDisplay();
        clearProductInfo();
        return;
    }

    currentSale.productId = parseInt(opt.value);
    currentSale.unitPrice = parseFloat(opt.dataset.price);
    currentSale.unitCost  = parseFloat(opt.dataset.cost);

    const maxQty   = parseInt(opt.dataset.qty);
    const qtyInput = document.getElementById('saleQty');
    if (qtyInput) {
        qtyInput.max = maxQty;
        if (parseInt(qtyInput.value) > maxQty) qtyInput.value = maxQty;
        currentSale.qty = parseInt(qtyInput.value) || 1;
    }

    showProductInfo(opt.value, maxQty);
    updateAmountDisplay();
    updateReceiptPreview();
}

function showProductInfo(productId, availableQty) {
    const el = document.getElementById('productInfo');
    if (!el) return;
    const p = _products.find(pr => pr.id == productId);
    if (!p) return;

    const status = getStockStatus(p.quantity);
    el.innerHTML = `
        <div style="display:flex;align-items:center;gap:0.75rem;padding:0.75rem;background:rgba(59,130,246,0.06);border:1px solid rgba(59,130,246,0.15);border-radius:var(--radius);">
            <span style="font-size:1.5rem;">${p.icon || '📦'}</span>
            <div>
                <div style="font-weight:600;font-size:0.9rem;">${escHtml(p.name)}</div>
                <div style="font-size:0.8rem;color:var(--text-light);">${escHtml(p.brand || '')} &bull; ${escHtml(p.category || '')}</div>
                <div style="font-size:0.8rem;margin-top:0.2rem;">Available: <strong>${availableQty}</strong> &nbsp; <span class="badge ${status.cls}">${status.label}</span></div>
            </div>
        </div>`;
    el.style.display = 'block';
}

function clearProductInfo() {
    const el = document.getElementById('productInfo');
    if (el) { el.innerHTML = ''; el.style.display = 'none'; }
}

// ===== AMOUNT DISPLAY =====
function updateAmountDisplay() {
    const qty    = currentSale.qty || 1;
    const total  = currentSale.unitPrice * qty;
    const cost   = currentSale.unitCost  * qty;
    const profit = total - cost;

    setVal('displayUnitPrice', formatCurrency(currentSale.unitPrice));
    setVal('displayQty',       qty);
    setVal('displayTotal',     formatCurrency(total));
    setVal('displayProfit',    formatCurrency(profit));
    setVal('displayCost',      formatCurrency(cost));
}

// ===== PAYMENT METHOD =====
function selectPaymentMethod(method) {
    currentSale.paymentMethod = method;
    document.querySelectorAll('.payment-method-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.method === method);
    });
    updateReceiptPreview();
}

// ===== RECEIPT PREVIEW =====
function updateReceiptPreview() {
    const qty    = currentSale.qty || 1;
    const total  = currentSale.unitPrice * qty;
    const product = currentSale.productId ? _products.find(p => p.id === currentSale.productId) : null;
    const customerName = document.getElementById('customerName')?.value.trim() || '—';

    setInner('receiptCompanyName', escHtml(_settings.company_name || 'Reliavolt Supply'));
    setInner('receiptNo',          currentSale.receiptNo || '—');
    setInner('receiptDate',        formatDateTime(new Date().toISOString()));
    setInner('receiptCustomer',    escHtml(customerName));
    setInner('receiptPayment',     currentSale.paymentMethod);
    setInner('receiptProductName', product ? escHtml(product.name) : '—');
    setInner('receiptQty',         qty);
    setInner('receiptUnitPrice',   product ? formatCurrency(currentSale.unitPrice) : '—');
    setInner('receiptSubtotal',    formatCurrency(total));
    setInner('receiptTotal',       formatCurrency(total));
    setInner('receiptFooterText',  _settings.receipt_footer || 'Thank you for your business!');
}

// ===== RECORD SALE =====
async function recordSale() {
    if (!currentSale.productId) { showToast('Please select a product.', 'error'); return; }

    const qty          = parseInt(document.getElementById('saleQty').value) || 1;
    const customerName = document.getElementById('customerName').value.trim();
    const paymentMethod = currentSale.paymentMethod;
    const shopId       = parseInt(document.getElementById('saleShop')?.value) || null;

    if (qty < 1) { showToast('Quantity must be at least 1.', 'error'); return; }

    const product = _products.find(p => p.id === currentSale.productId);
    if (!product) { showToast('Product not found.', 'error'); return; }
    if (product.quantity < qty) { showToast(`Only ${product.quantity} units available in stock.`, 'warning'); return; }

    try {
        const sale = await api.post('/api/sales', {
            product_id:     currentSale.productId,
            customer_name:  customerName || 'Walk-in Customer',
            qty,
            payment_method: paymentMethod,
            shop_id:        shopId,
        });

        // Update local product quantity and sales list
        const pidx = _products.findIndex(p => p.id === currentSale.productId);
        if (pidx !== -1) _products[pidx].quantity -= qty;

        _sales.unshift(sale);

        currentSale.receiptNo = sale.receipt_no;
        updateReceiptPreview();

        showToast(`Sale recorded! Receipt: ${sale.receipt_no}`, 'success');
        renderRecentSales();
        resetSaleForm();
        populateProductSelect();
    } catch (err) {
        showToast(err.message, 'error');
    }
}

function resetSaleForm() {
    currentSale.productId  = null;
    currentSale.unitPrice  = 0;
    currentSale.unitCost   = 0;
    currentSale.qty        = 1;
    currentSale.receiptNo  = '—';

    const select = document.getElementById('productSelect');
    if (select) select.value = '';

    const qtyInput = document.getElementById('saleQty');
    if (qtyInput) qtyInput.value = 1;

    const custInput = document.getElementById('customerName');
    if (custInput) custInput.value = '';

    clearProductInfo();
    updateAmountDisplay();
    updateReceiptPreview();
}

// ===== RECENT SALES TABLE =====
function renderRecentSales() {
    const tbody = document.getElementById('recentSalesBody');
    if (!tbody) return;

    const sales = _sales.slice(0, 20);
    if (!sales.length) {
        tbody.innerHTML = `<tr><td colspan="8"><div class="empty-state"><span class="empty-icon">🛒</span><p>No sales recorded yet.</p></div></td></tr>`;
        return;
    }

    tbody.innerHTML = sales.map(s => `
        <tr>
            <td><strong>${escHtml(s.receipt_no)}</strong></td>
            <td>${escHtml(s.customer_name)}</td>
            <td>${escHtml(s.product_name)}</td>
            <td>${s.qty}</td>
            <td><strong>${formatCurrency(s.total)}</strong></td>
            <td><span style="color:#16a34a;font-weight:600;">${formatCurrency(s.profit)}</span></td>
            <td><span class="badge badge-secondary">${escHtml(s.payment_method || 'Cash')}</span></td>
            <td>
                ${isAdmin() ? `<button class="btn btn-danger btn-sm" onclick="deleteSale(${s.id})">🗑️ Delete</button>` : '—'}
            </td>
        </tr>`).join('');
}

// ===== DELETE SALE =====
async function deleteSale(id) {
    const sale = _sales.find(s => s.id === id);
    if (!sale) return;

    showConfirm('Delete Sale', `Permanently delete receipt ${sale.receipt_no}? This cannot be undone.`, async () => {
        try {
            await api.delete(`/api/sales/${id}`);
            _sales = _sales.filter(s => s.id !== id);
            showToast(`Receipt ${sale.receipt_no} deleted.`, 'warning');
            renderRecentSales();
        } catch (err) {
            showToast(err.message, 'error');
        }
    });
}

// ===== POPULATE CUSTOMER DATALIST =====
function populateCustomerDatalist() {
    const list = document.getElementById('customerList');
    if (!list) return;
    list.innerHTML = _customers.map(c => `<option value="${escHtml(c.name)}">`).join('');
}

// ===== HELPERS =====
function setVal(id, val)   { const el = document.getElementById(id); if (el) el.textContent = val; }
function setInner(id, val) { const el = document.getElementById(id); if (el) el.textContent = val; }

function escHtml(str) {
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ===== INIT =====
document.addEventListener('DOMContentLoaded', async () => {
    try {
        [_products, _shops, _customers, _sales, _settings] = await Promise.all([
            api.get('/api/products'),
            api.get('/api/shops'),
            api.get('/api/customers'),
            api.get('/api/sales'),
            api.get('/api/settings').catch(() => ({})),
        ]);
    } catch (err) {
        showToast('Failed to load data: ' + err.message, 'error');
        _products = []; _shops = []; _customers = []; _sales = []; _settings = {};
    }

    populateShopSelect();
    populateProductSelect();
    populateCustomerDatalist();
    renderRecentSales();
    updateAmountDisplay();
    updateReceiptPreview();

    // Hide deleted sales section — API uses hard-delete only
    const deletedSection = document.getElementById('deletedSalesSection');
    if (deletedSection) deletedSection.style.display = 'none';

    document.getElementById('productSelect')?.addEventListener('change', onProductChange);

    const qtyInput = document.getElementById('saleQty');
    qtyInput && qtyInput.addEventListener('input', () => {
        currentSale.qty = parseInt(qtyInput.value) || 1;
        updateAmountDisplay();
        updateReceiptPreview();
    });

    document.getElementById('customerName')?.addEventListener('input', updateReceiptPreview);

    document.querySelectorAll('.payment-method-btn').forEach(btn => {
        btn.addEventListener('click', () => selectPaymentMethod(btn.dataset.method));
    });

    document.getElementById('recordSaleBtn')?.addEventListener('click', recordSale);
    document.getElementById('printReceiptBtn')?.addEventListener('click', () => window.print());
    document.getElementById('newSaleBtn')?.addEventListener('click', () => {
        resetSaleForm();
        updateReceiptPreview();
    });
});
