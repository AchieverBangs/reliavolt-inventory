// ===== STATE =====
let _sales    = [];
let _products = [];
let _shops    = [];
let _users    = [];

// ===== FILTER HELPERS =====
function getSalesByPeriod(period) {
    if (period === 'daily')   return _sales.filter(s => isSameDay(s.sale_date, todayStr()));
    if (period === 'weekly')  return _sales.filter(s => isSameWeek(s.sale_date));
    if (period === 'monthly') return _sales.filter(s => isSameMonth(s.sale_date));
    return _sales;
}

function calcStats(sales) {
    const revenue = sales.reduce((sum, s) => sum + Number(s.total), 0);
    const profit  = sales.reduce((sum, s) => sum + Number(s.profit), 0);
    return {
        count:  sales.length,
        revenue,
        profit,
        avg:    sales.length ? revenue / sales.length : 0,
        margin: revenue > 0 ? ((profit / revenue) * 100).toFixed(1) : '0.0',
    };
}

// ===== RENDER SALES SUMMARY =====
function renderSalesSummary(period) {
    const labels = { daily: "Today's Sales", weekly: "This Week's Sales", monthly: "This Month's Sales" };
    setEl('salesSectionTitle', labels[period] || "Sales");

    const stats = calcStats(getSalesByPeriod(period));
    setEl('sumRevenue', formatCurrency(stats.revenue));
    setEl('sumProfit',  formatCurrency(stats.profit));
    setEl('sumCount',   stats.count);
    setEl('sumAvg',     formatCurrency(stats.avg));
    setEl('sumMargin',  `${stats.margin}%`);
}

// ===== RENDER SALES TABLE =====
function renderSalesTable(period) {
    const sales = getSalesByPeriod(period).slice();
    const tbody = document.getElementById('reportSalesBody');
    if (!tbody) return;

    if (!sales.length) {
        tbody.innerHTML = `<tr><td colspan="7">
            <div class="empty-state"><span class="empty-icon">📊</span><p>No sales for this period.</p></div>
        </td></tr>`;
        return;
    }

    tbody.innerHTML = sales.map(s => `<tr>
        <td><strong>${escHtml(s.receipt_no)}</strong></td>
        <td>${escHtml(s.customer_name)}</td>
        <td>${escHtml(s.product_name)}</td>
        <td>${s.qty}</td>
        <td><strong>${formatCurrency(s.total)}</strong></td>
        <td class="profit-text">${formatCurrency(s.profit)}</td>
        <td>${formatDate(s.sale_date)}</td>
    </tr>`).join('');
}

// ===== PROFIT REPORT =====
function renderProfitReport() {
    const map = {};
    _sales.forEach(s => {
        const key = s.product_name;
        if (!map[key]) map[key] = { name: key, qty: 0, revenue: 0, profit: 0 };
        map[key].qty     += s.qty;
        map[key].revenue += Number(s.total);
        map[key].profit  += Number(s.profit);
    });

    const sorted = Object.values(map).sort((a, b) => b.profit - a.profit);
    const tbody  = document.getElementById('profitReportBody');
    if (!tbody) return;

    if (!sorted.length) {
        tbody.innerHTML = `<tr><td colspan="5"><div class="empty-state"><span class="empty-icon">📈</span><p>No data yet.</p></div></td></tr>`;
        return;
    }

    tbody.innerHTML = sorted.map((p, i) => {
        const margin = p.revenue > 0 ? ((p.profit / p.revenue) * 100).toFixed(1) : 0;
        return `<tr>
            <td>${i + 1}</td>
            <td><strong>${escHtml(p.name)}</strong></td>
            <td>${p.qty}</td>
            <td><strong>${formatCurrency(p.revenue)}</strong></td>
            <td><span class="profit-text">${formatCurrency(p.profit)}</span>
                <span class="margin-text">(${margin}%)</span></td>
        </tr>`;
    }).join('');

    setEl('totalProfitAll', formatCurrency(sorted.reduce((s, p) => s + p.profit, 0)));
}

// ===== LOW STOCK REPORT =====
function renderLowStockReport() {
    const low   = _products.filter(p => p.quantity <= LOW_STOCK_THRESHOLD).sort((a, b) => a.quantity - b.quantity);
    const tbody = document.getElementById('lowStockBody');
    if (!tbody) return;

    setEl('lowStockCount', low.length);

    if (!low.length) {
        tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state"><span class="empty-icon">✅</span><p>All products are adequately stocked.</p></div></td></tr>`;
        return;
    }

    tbody.innerHTML = low.map(p => {
        const status  = getStockStatus(p.quantity);
        const reorder = Math.max(0, LOW_STOCK_THRESHOLD * 5 - p.quantity);
        return `<tr>
            <td><span class="product-icon-sm">${p.icon || '📦'}</span> <strong>${escHtml(p.name)}</strong></td>
            <td>${escHtml(p.category || '')}</td>
            <td>${escHtml(p.brand    || '')}</td>
            <td class="${p.quantity === 0 ? 'qty-out' : 'qty-low'}">${p.quantity}</td>
            <td><span class="badge ${status.cls}">${status.label}</span></td>
            <td class="${reorder > 0 ? 'reorder-text' : 'ok-text'}">${reorder > 0 ? `Reorder ${reorder} units` : 'OK'}</td>
        </tr>`;
    }).join('');
}

// ===== WEEKLY CHART =====
function renderWeeklyChart() {
    const canvas = document.getElementById('weeklyChart');
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

    const W      = canvas.width  = canvas.offsetWidth || 700;
    const H      = canvas.height = 220;
    const padL = 65, padR = 20, padT = 20, padB = 40;
    const maxVal = Math.max(...revenueData, 1);
    const barGroupW = (W - padL - padR) / labels.length;

    ctx.clearRect(0, 0, W, H);
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth   = 1;

    for (let i = 0; i <= 4; i++) {
        const y = padT + ((H - padT - padB) / 4) * i;
        ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W - padR, y); ctx.stroke();
        ctx.fillStyle = '#94a3b8';
        ctx.font = '11px Segoe UI, sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText(fmtK(maxVal - (maxVal / 4) * i), padL - 6, y + 4);
    }

    labels.forEach((label, i) => {
        const x      = padT + i * barGroupW;
        const chartH = H - padT - padB;
        const revH   = (revenueData[i] / maxVal) * chartH;
        const profH  = (profitData[i]  / maxVal) * chartH;
        const bw     = barGroupW * 0.32;

        const rg = ctx.createLinearGradient(0, H - padB - revH, 0, H - padB);
        rg.addColorStop(0, '#1a3a8f'); rg.addColorStop(1, '#93c5fd');
        ctx.fillStyle = rg;
        drawRoundRect(ctx, x + padL - padT + barGroupW * 0.06, H - padB - revH, bw, revH, 3);

        const pg = ctx.createLinearGradient(0, H - padB - profH, 0, H - padB);
        pg.addColorStop(0, '#22c55e'); pg.addColorStop(1, '#86efac');
        ctx.fillStyle = pg;
        drawRoundRect(ctx, x + padL - padT + barGroupW * 0.52, H - padB - profH, bw, profH, 3);

        ctx.fillStyle = '#64748b';
        ctx.font = '11px Segoe UI, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(label, x + padL - padT + barGroupW / 2, H - padB + 16);
    });
}

function drawRoundRect(ctx, x, y, w, h, r) {
    if (h <= 0 || w <= 0) return;
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

// ===== BY SHOP REPORT =====
function populateShopReportSelect() {
    const select = document.getElementById('shopReportSelect');
    if (!select) return;
    select.innerHTML = '<option value="">-- Choose a Shop --</option>' +
        _shops.map(s => `<option value="${s.id}">${escHtml(s.name)} — ${s.status}</option>`).join('');
}

function renderShopReport(shopId) {
    const id   = parseInt(shopId);
    const shop = _shops.find(s => s.id === id);
    if (!shop) return;

    document.getElementById('shopReportContent').style.display = 'block';
    document.getElementById('shopReportEmpty').style.display   = 'none';

    const sales   = _sales.filter(s => s.shop_id === id);
    const revenue = sales.reduce((sum, s) => sum + Number(s.total),  0);
    const profit  = sales.reduce((sum, s) => sum + Number(s.profit), 0);
    const margin  = revenue > 0 ? ((profit / revenue) * 100).toFixed(1) : '0.0';

    setEl('shopSalesTitle', `Sales — ${shop.name}`);

    const statGrid = document.getElementById('shopStatGrid');
    if (statGrid) {
        statGrid.innerHTML = `
            <div class="card rpt-stat-card">
                <div class="rpt-stat-icon">🏪</div>
                <div class="rpt-stat-label">Shop</div>
                <div class="rpt-stat-value primary" style="font-size:1rem;">${escHtml(shop.name)}</div>
            </div>
            <div class="card rpt-stat-card">
                <div class="rpt-stat-icon">💰</div>
                <div class="rpt-stat-label">Revenue</div>
                <div class="rpt-stat-value primary">${formatCurrency(revenue)}</div>
            </div>
            <div class="card rpt-stat-card">
                <div class="rpt-stat-icon">📈</div>
                <div class="rpt-stat-label">Profit</div>
                <div class="rpt-stat-value green">${formatCurrency(profit)}</div>
            </div>
            <div class="card rpt-stat-card">
                <div class="rpt-stat-icon">🛒</div>
                <div class="rpt-stat-label">Transactions</div>
                <div class="rpt-stat-value">${sales.length}</div>
            </div>
            <div class="card rpt-stat-card">
                <div class="rpt-stat-icon">%</div>
                <div class="rpt-stat-label">Margin</div>
                <div class="rpt-stat-value orange">${margin}%</div>
            </div>`;
    }

    const salesBody = document.getElementById('shopSalesBody');
    if (salesBody) {
        if (!sales.length) {
            salesBody.innerHTML = `<tr><td colspan="8"><div class="empty-state"><span class="empty-icon">🛒</span><p>No sales recorded for this shop.</p></div></td></tr>`;
        } else {
            salesBody.innerHTML = sales.slice().map(s => `<tr>
                <td><strong>${escHtml(s.receipt_no)}</strong></td>
                <td>${escHtml(s.customer_name)}</td>
                <td>${escHtml(s.product_name)}</td>
                <td>${s.qty}</td>
                <td><strong>${formatCurrency(s.total)}</strong></td>
                <td class="profit-text">${formatCurrency(s.profit)}</td>
                <td><span class="badge badge-secondary">${escHtml(s.payment_method || '—')}</span></td>
                <td>${formatDate(s.sale_date)}</td>
            </tr>`).join('');
        }
    }

    const shopUsers = _users.filter(u => u.shop_id === id);
    const staffBody = document.getElementById('shopStaffBody');
    if (staffBody) {
        if (!shopUsers.length) {
            staffBody.innerHTML = `<tr><td colspan="4"><div class="empty-state"><span class="empty-icon">👤</span><p>No staff assigned to this shop.</p></div></td></tr>`;
        } else {
            const ROLE_BADGE = { Admin:'role-admin', Manager:'role-manager', Cashier:'role-cashier', 'Stock Manager':'role-stock', 'Delivery Person':'role-driver' };
            staffBody.innerHTML = shopUsers.map(u => `<tr>
                <td><strong>${escHtml(u.name)}</strong></td>
                <td>@${escHtml(u.username)}</td>
                <td><span class="role-badge ${ROLE_BADGE[u.role] || 'role-cashier'}">${escHtml(u.role)}</span></td>
                <td><span class="badge ${u.status === 'Active' ? 'badge-success' : 'badge-secondary'}">${u.status}</span></td>
            </tr>`).join('');
        }
    }
}

// ===== TAB SWITCHING =====
function switchReportTab(period) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.period === period));
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));

    if (['daily', 'weekly', 'monthly'].includes(period)) {
        document.getElementById('tab-sales').classList.add('active');
        renderSalesSummary(period);
        renderSalesTable(period);
    } else if (period === 'profit') {
        document.getElementById('tab-profit').classList.add('active');
        renderProfitReport();
    } else if (period === 'lowstock') {
        document.getElementById('tab-lowstock').classList.add('active');
        renderLowStockReport();
    } else if (period === 'chart') {
        document.getElementById('tab-chart').classList.add('active');
        setTimeout(renderWeeklyChart, 50);
    } else if (period === 'byshop') {
        document.getElementById('tab-byshop').classList.add('active');
        populateShopReportSelect();
        const current = document.getElementById('shopReportSelect')?.value;
        if (current) renderShopReport(current);
    }
}

// ===== HELPERS =====
function setEl(id, val) { const el = document.getElementById(id); if (el) el.textContent = val; }

function escHtml(str) {
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ===== INIT =====
document.addEventListener('DOMContentLoaded', async () => {
    try {
        [_sales, _products, _shops, _users] = await Promise.all([
            api.get('/api/sales'),
            api.get('/api/products'),
            api.get('/api/shops'),
            api.get('/api/users').catch(() => []),
        ]);
    } catch (err) {
        showToast('Failed to load reports: ' + err.message, 'error');
        _sales = []; _products = []; _shops = []; _users = [];
    }

    const validTabs = ['daily', 'weekly', 'monthly', 'profit', 'lowstock', 'chart', 'byshop'];
    const hash      = window.location.hash.slice(1);
    const startTab  = validTabs.includes(hash) ? hash : 'daily';
    switchReportTab(startTab);

    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => switchReportTab(btn.dataset.period));
    });

    document.getElementById('printReportBtn')?.addEventListener('click',     () => window.print());
    document.getElementById('printShopReportBtn')?.addEventListener('click', () => window.print());
    document.getElementById('shopReportSelect')?.addEventListener('change', e => {
        if (e.target.value) renderShopReport(e.target.value);
        else {
            document.getElementById('shopReportContent').style.display = 'none';
            document.getElementById('shopReportEmpty').style.display   = 'block';
        }
    });

    window.addEventListener('resize', () => {
        const activeTab = document.querySelector('.tab-btn.active');
        if (activeTab && activeTab.dataset.period === 'chart') renderWeeklyChart();
    });
});
