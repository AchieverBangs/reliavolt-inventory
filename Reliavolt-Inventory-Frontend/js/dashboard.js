// ===== STATE =====
let _products   = [];
let _sales      = [];
let _deliveries = [];
let _shops      = [];

// ===== STATS =====
function renderDashboardStats() {
    const today        = todayStr();
    const todaySales   = _sales.filter(s => isSameDay(s.sale_date, today));
    const monthlySales = _sales.filter(s => isSameMonth(s.sale_date));

    const totalSalesToday = todaySales.reduce((sum, s) => sum + Number(s.total), 0);
    const profitToday     = todaySales.reduce((sum, s) => sum + Number(s.profit), 0);
    const profitMonthly   = monthlySales.reduce((sum, s) => sum + Number(s.profit), 0);

    const lowStock = _products.filter(p => p.quantity > 0 && p.quantity <= LOW_STOCK_THRESHOLD);
    const outStock = _products.filter(p => p.quantity === 0);

    setEl('statTotalProducts', _products.length);
    setEl('statProductsSub',   `${_products.filter(p => p.quantity > 0).length} in stock`);
    setEl('statSalesToday',    formatCurrency(totalSalesToday));
    setEl('statSalesTodaySub', `${todaySales.length} transaction${todaySales.length !== 1 ? 's' : ''}`);
    setEl('statProfitToday',   formatCurrency(profitToday));
    setEl('statProfitMonthly', formatCurrency(profitMonthly));
    setEl('statLowStock',      lowStock.length);
    setEl('statLowStockSub',   lowStock.length ? `${lowStock.length} item${lowStock.length !== 1 ? 's' : ''} need attention` : 'All OK');
    setEl('statOutStock',      outStock.length);
    setEl('statOutStockSub',   outStock.length ? `${outStock.length} item${outStock.length !== 1 ? 's' : ''} unavailable` : 'All OK');
}

// ===== RECENT SALES =====
function renderRecentSalesList() {
    const container = document.getElementById('recentSalesList');
    if (!container) return;

    const sales = _sales.slice(0, 8);
    if (!sales.length) {
        container.innerHTML = `<div class="empty-state"><span class="empty-icon">🛒</span><p>No recent sales.</p></div>`;
        return;
    }

    container.innerHTML = sales.map(s => {
        const name     = s.customer_name || 'Walk-in Customer';
        const initials = name.split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase();
        return `<a href="sales.html" class="sale-item sale-item-link">
            <div class="sale-avatar">${initials}</div>
            <div class="sale-info">
                <div class="sale-name">${escHtml(name)}</div>
                <div class="sale-product">${escHtml(s.product_name)}</div>
            </div>
            <div style="text-align:right;">
                <div class="sale-amount">${formatCurrency(s.total)}</div>
                <div class="sale-time">${formatDate(s.sale_date)}</div>
            </div>
        </a>`;
    }).join('');
}

// ===== LOW STOCK TABLE =====
function renderLowStockTable() {
    const alerts = _products.filter(p => p.quantity <= LOW_STOCK_THRESHOLD).sort((a, b) => a.quantity - b.quantity);
    const tbody  = document.getElementById('lowStockTableBody');
    if (!tbody) return;

    if (!alerts.length) {
        tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state"><span class="empty-icon">✅</span><p>All items are adequately stocked.</p></div></td></tr>`;
        return;
    }

    const filter = (p) => p.quantity === 0 ? 'inventory.html#out' : 'inventory.html#low';
    tbody.innerHTML = alerts.map(p => {
        const status = getStockStatus(p.quantity);
        return `<tr class="clickable-row" onclick="window.location.href='${filter(p)}'" title="Click to manage in Inventory">
            <td>
                <div style="display:flex;align-items:center;gap:0.5rem;">
                    <span>${p.icon || '📦'}</span>
                    <strong>${escHtml(p.name)}</strong>
                </div>
            </td>
            <td>${escHtml(p.category || '')}</td>
            <td>${escHtml(p.brand    || '')}</td>
            <td style="font-weight:700;color:${p.quantity === 0 ? '#dc2626' : '#d97706'}">${p.quantity}</td>
            <td><span class="badge ${status.cls}">${status.label}</span></td>
            <td>${formatCurrency(p.selling_price)}</td>
        </tr>`;
    }).join('');
}

// ===== SALES CHART =====
function renderSalesChart() {
    const canvas = document.getElementById('salesChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const labels = [], revenueData = [], profitData = [];

    for (let i = 6; i >= 0; i--) {
        const d       = new Date();
        d.setDate(d.getDate() - i);
        const dateStr = d.toISOString().split('T')[0];
        const daySales = _sales.filter(s => (s.sale_date || '').split('T')[0] === dateStr);
        labels.push(dayNames[d.getDay()]);
        revenueData.push(daySales.reduce((sum, s) => sum + Number(s.total),  0));
        profitData.push( daySales.reduce((sum, s) => sum + Number(s.profit), 0));
    }

    const W       = canvas.width  = canvas.offsetWidth || 600;
    const H       = canvas.height = 220;
    const padL = 65, padR = 20, padT = 20, padB = 40;
    const maxVal  = Math.max(...revenueData, 1);
    const barAreaW  = W - padL - padR;
    const barGroupW = barAreaW / labels.length;

    ctx.clearRect(0, 0, W, H);

    const isDark     = document.documentElement.getAttribute('data-theme') === 'dark';
    const gridColor  = isDark ? '#334155' : '#e2e8f0';
    const labelColor = isDark ? '#94a3b8' : '#94a3b8';
    const dayColor   = isDark ? '#94a3b8' : '#64748b';

    ctx.strokeStyle = gridColor;
    ctx.lineWidth   = 1;
    ctx.fillStyle   = labelColor;
    ctx.font = '11px Segoe UI, sans-serif';
    ctx.textAlign = 'right';

    for (let i = 0; i <= 4; i++) {
        const y = padT + ((H - padT - padB) / 4) * i;
        ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W - padR, y); ctx.stroke();
        ctx.fillText(fmtK(maxVal - (maxVal / 4) * i), padL - 6, y + 4);
    }

    labels.forEach((label, i) => {
        const x      = padL + i * barGroupW;
        const chartH = H - padT - padB;
        const revH   = (revenueData[i] / maxVal) * chartH;
        const profH  = (profitData[i]  / maxVal) * chartH;
        const bw     = barGroupW * 0.32;

        const revGrad = ctx.createLinearGradient(0, H - padB - revH, 0, H - padB);
        revGrad.addColorStop(0, '#1a3a8f'); revGrad.addColorStop(1, '#93c5fd');
        ctx.fillStyle = revGrad;
        roundRect(ctx, x + barGroupW * 0.06, H - padB - revH, bw, revH, 3);

        const profGrad = ctx.createLinearGradient(0, H - padB - profH, 0, H - padB);
        profGrad.addColorStop(0, '#22c55e'); profGrad.addColorStop(1, '#86efac');
        ctx.fillStyle = profGrad;
        roundRect(ctx, x + barGroupW * 0.52, H - padB - profH, bw, profH, 3);

        ctx.fillStyle = dayColor;
        ctx.font = '11px Segoe UI, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(label, x + barGroupW / 2, H - padB + 16);
    });
}

function roundRect(ctx, x, y, w, h, r) {
    if (h <= 0) return;
    r = Math.min(r, h / 2, w / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h); ctx.lineTo(x, y + h); ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath(); ctx.fill();
}

function fmtK(n) {
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000)    return (n / 1000).toFixed(0) + 'K';
    return Math.round(n);
}

// ===== DRIVER DASHBOARD =====
function renderDriverDashboard() {
    const shopId = getCurrentUserShopId();
    const shop   = shopId ? _shops.find(s => s.id === shopId) : null;

    setEl('driverWelcomeName', `Welcome, ${getCurrentUserName() || 'Driver'}!`);
    setEl('driverWelcomeShop', shop ? `Assigned Shop: ${shop.name} — ${shop.address || ''}` : 'No shop assigned');

    const deliveries = shopId ? _deliveries.filter(d => d.from_shop_id === shopId) : _deliveries;
    const pending    = deliveries.filter(d => d.status === 'Pending');
    const transit    = deliveries.filter(d => d.status === 'In Transit');
    const delivered  = deliveries.filter(d => d.status === 'Delivered');
    const active     = [...pending, ...transit].sort((a, b) => new Date(b.delivery_date) - new Date(a.delivery_date));
    const past       = deliveries.filter(d => d.status === 'Delivered' || d.status === 'Cancelled')
                                 .sort((a, b) => new Date(b.delivery_date) - new Date(a.delivery_date));

    setEl('drvPending',   pending.length);
    setEl('drvTransit',   transit.length);
    setEl('drvDelivered', delivered.length);

    renderDriverTable('drvPendingBody', active,
        `<tr><td colspan="7"><div class="empty-state"><span class="empty-icon">✅</span><p>No pending or in-transit deliveries.</p></div></td></tr>`,
        true);
    renderDriverTable('drvHistoryBody', past.slice(0, 15),
        `<tr><td colspan="6"><div class="empty-state"><span class="empty-icon">📦</span><p>No past deliveries yet.</p></div></td></tr>`,
        false);
}

function driverActionBtn(d) {
    if (d.status === 'Pending')    return `<button class="btn btn-warning btn-sm" onclick="dashDriverConfirm(${d.id},'In Transit')">🚛 Start</button>`;
    if (d.status === 'In Transit') return `<button class="btn btn-success btn-sm" onclick="dashDriverConfirm(${d.id},'Delivered')">✅ Delivered</button>`;
    return '<span style="color:var(--text-light);font-size:0.8rem;">—</span>';
}

async function dashDriverConfirm(id, newStatus) {
    const label = newStatus === 'In Transit' ? 'start this delivery?' : 'mark this delivery as Delivered?';
    showConfirm('Confirm Status', `Are you sure you want to ${label}`, async () => {
        try {
            await api.patch(`/api/deliveries/${id}/status`, { status: newStatus });
            const idx = _deliveries.findIndex(d => d.id === id);
            if (idx !== -1) {
                showToast(`Delivery ${_deliveries[idx].delivery_no} → ${newStatus}`, 'success');
                _deliveries[idx].status = newStatus;
            }
            renderDriverDashboard();
        } catch (err) {
            showToast(err.message, 'error');
        }
    });
}

function renderDriverTable(tbodyId, rows, emptyHtml, showAction = false) {
    const tbody = document.getElementById(tbodyId);
    if (!tbody) return;
    if (!rows.length) { tbody.innerHTML = emptyHtml; return; }

    const STATUS_CLS = {
        'Pending':    'status-pending',
        'In Transit': 'status-transit',
        'Delivered':  'status-delivered',
        'Cancelled':  'status-cancelled',
    };

    tbody.innerHTML = rows.map(d => {
        const dest    = d.type === 'Customer Delivery'
            ? escHtml(d.customer_name || d.to_name || '—')
            : escHtml(_shops.find(s => s.id === d.to_shop_id)?.name || d.to_name || '—');
        const items   = Array.isArray(d.products) ? d.products.length : '—';
        const cls     = STATUS_CLS[d.status] || '';
        const actionTd = showAction ? `<td>${driverActionBtn(d)}</td>` : '';
        return `<tr>
            <td><strong>${escHtml(d.delivery_no)}</strong></td>
            <td>${escHtml(d.type || '—')}</td>
            <td>${dest}</td>
            <td>${items} item${items !== 1 ? 's' : ''}</td>
            <td><span class="badge ${cls}">${escHtml(d.status)}</span></td>
            <td>${formatDate(d.delivery_date)}</td>
            ${actionTd}
        </tr>`;
    }).join('');
}

// ===== HELPERS =====
function setEl(id, val) { const el = document.getElementById(id); if (el) el.textContent = val; }

function escHtml(str) {
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ===== INIT =====
document.addEventListener('DOMContentLoaded', async () => {
    const isDriver = getCurrentUserRole() === 'Delivery Person';
    const mainEl   = document.getElementById('mainDashboard');
    const driverEl = document.getElementById('driverDashboard');

    if (isDriver) {
        if (mainEl)   mainEl.classList.add('hidden');
        if (driverEl) driverEl.classList.remove('hidden');

        try {
            [_deliveries, _shops] = await Promise.all([
                api.get('/api/deliveries'),
                api.get('/api/shops'),
            ]);
        } catch (err) {
            showToast('Failed to load delivery data: ' + err.message, 'error');
            _deliveries = []; _shops = [];
        }
        renderDriverDashboard();
    } else {
        try {
            [_products, _sales, _shops, _deliveries] = await Promise.all([
                api.get('/api/products'),
                api.get('/api/sales'),
                api.get('/api/shops'),
                api.get('/api/deliveries').catch(() => []),
            ]);
        } catch (err) {
            showToast('Failed to load dashboard: ' + err.message, 'error');
            _products = []; _sales = []; _shops = []; _deliveries = [];
        }

        renderDashboardStats();
        renderRecentSalesList();
        renderLowStockTable();
        setTimeout(renderSalesChart, 50);
        window.addEventListener('resize', () => setTimeout(renderSalesChart, 50));
    }
});
