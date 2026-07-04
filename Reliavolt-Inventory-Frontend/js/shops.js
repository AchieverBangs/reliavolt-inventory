// ===== STATE =====
let _shops = [];
let _users = [];
let editingShopId = null;
let activeFilter  = false;

// ===== RENDER STATS =====
function renderShopStats() {
    setEl('totalShops',  _shops.length);
    setEl('activeShops', _shops.filter(s => s.status === 'Active').length);
    setEl('totalStaff',  _users.filter(u => u.status === 'Active' && u.role !== 'Admin').length);
}

// ===== RENDER SHOP CARDS =====
function renderShopCards() {
    const container = document.getElementById('shopsGrid');
    if (!container) return;

    let shops = activeFilter ? _shops.filter(s => s.status === 'Active') : _shops;

    if (!shops.length) {
        const msg = activeFilter ? 'No active shops found.' : 'No shops added yet.';
        container.innerHTML = `<div class="empty-state"><span class="empty-icon">🏪</span><p>${msg}</p></div>`;
        return;
    }

    container.innerHTML = shops.map(shop => {
        const staffCount = _users.filter(u => u.shop_id === shop.id && u.status === 'Active').length;
        const badgeCls   = shop.status === 'Active' ? 'badge-success' : shop.status === 'Planned' ? 'badge-warning' : 'badge-secondary';
        const statusCls  = shop.status === 'Active' ? 'active' : shop.status === 'Planned' ? 'planned' : '';

        return `<div class="shop-card ${statusCls}">
            <div class="shop-card-accent"></div>
            <div class="shop-card-body">
                <div class="shop-card-header">
                    <div class="shop-icon">🏪</div>
                    <span class="badge ${badgeCls}">${shop.status}</span>
                </div>
                <div class="shop-name">${escHtml(shop.name)}</div>
                <div class="shop-id-text">Shop #${shop.id}</div>

                <div style="margin-top:0.875rem;">
                    <div class="shop-detail-row">
                        <span class="shop-detail-icon">📍</span>
                        <span class="shop-detail-text">${escHtml(shop.address)}</span>
                    </div>
                    <div class="shop-detail-row">
                        <span class="shop-detail-icon">📞</span>
                        <span class="shop-detail-text">${escHtml(shop.phone || '—')}</span>
                    </div>
                    <div class="shop-detail-row">
                        <span class="shop-detail-icon">👤</span>
                        <span class="shop-detail-text">Manager: <strong>${escHtml(shop.manager || 'Not Assigned')}</strong></span>
                    </div>
                </div>

                <div class="shop-stats-row">
                    <div class="shop-stat-item">
                        <div class="shop-stat-val">${staffCount}</div>
                        <div class="shop-stat-lbl">Staff</div>
                    </div>
                    <div class="shop-stat-item">
                        <div class="shop-stat-val">${formatDate(shop.created_at)}</div>
                        <div class="shop-stat-lbl">Opened</div>
                    </div>
                </div>
            </div>
            <div class="shop-card-footer">
                <button class="btn btn-warning btn-sm" onclick="openEditShop(${shop.id})">✏️ Edit</button>
                <button class="btn btn-danger btn-sm"  onclick="deleteShop(${shop.id})">🗑️ Delete</button>
            </div>
        </div>`;
    }).join('');
}

// ===== POPULATE MANAGER DATALIST =====
function populateManagerList() {
    const users = _users.filter(u => ['Admin', 'Manager'].includes(u.role) && u.status === 'Active');
    const list  = document.getElementById('managerList');
    if (list) list.innerHTML = users.map(u => `<option value="${escHtml(u.name)}">`).join('');
}

// ===== ADD / EDIT SHOP =====
function openAddShop() {
    editingShopId = null;
    document.getElementById('shopForm').reset();
    document.getElementById('shopModalTitle').textContent = 'Add New Shop';
    document.getElementById('saveShopBtn').textContent    = 'Add Shop';
    populateManagerList();
    openModal('shopModal');
}

function openEditShop(id) {
    const shop = _shops.find(s => s.id === id);
    if (!shop) return;

    editingShopId = id;
    document.getElementById('shopModalTitle').textContent = 'Edit Shop';
    document.getElementById('saveShopBtn').textContent    = 'Save Changes';
    document.getElementById('shopName').value             = shop.name;
    document.getElementById('shopAddress').value          = shop.address;
    document.getElementById('shopPhone').value            = shop.phone   || '';
    document.getElementById('shopManager').value          = shop.manager || '';
    document.getElementById('shopStatus').value           = shop.status;
    populateManagerList();
    openModal('shopModal');
}

async function saveShop() {
    const name    = document.getElementById('shopName').value.trim();
    const address = document.getElementById('shopAddress').value.trim();
    const phone   = document.getElementById('shopPhone').value.trim();
    const manager = document.getElementById('shopManager').value.trim();
    const status  = document.getElementById('shopStatus').value;

    if (!name || !address) { showToast('Shop name and address are required.', 'error'); return; }

    const payload = { name, address, phone, manager, status };

    try {
        if (editingShopId) {
            const updated = await api.put(`/api/shops/${editingShopId}`, payload);
            const idx = _shops.findIndex(s => s.id === editingShopId);
            if (idx !== -1) _shops[idx] = updated;
            showToast(`${name} updated.`, 'success');
        } else {
            const created = await api.post('/api/shops', payload);
            _shops.push(created);
            showToast(`${name} added!`, 'success');
        }
        closeModal('shopModal');
        renderShopStats();
        renderShopCards();
    } catch (err) {
        showToast(err.message, 'error');
    }
}

async function deleteShop(id) {
    const shop = _shops.find(s => s.id === id);
    if (!shop) return;

    const staffCount = _users.filter(u => u.shop_id === id).length;
    const message    = staffCount
        ? `"${shop.name}" has ${staffCount} staff member(s) assigned. They may need reassignment. Continue?`
        : `Remove "${shop.name}" from your shop list?`;

    showConfirm('Delete Shop', message, async () => {
        try {
            await api.delete(`/api/shops/${id}`);
            _shops = _shops.filter(s => s.id !== id);
            showToast(`${shop.name} removed.`, 'warning');
            renderShopStats();
            renderShopCards();
        } catch (err) {
            showToast(err.message, 'error');
        }
    });
}

// ===== HELPERS =====
function setEl(id, val) { const el = document.getElementById(id); if (el) el.textContent = val; }

function escHtml(str) {
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ===== INIT =====
document.addEventListener('DOMContentLoaded', async () => {
    if (!isAdmin()) {
        showToast('Access denied. Admin only.', 'error');
        setTimeout(() => window.location.href = 'dashboard.html', 1500);
        return;
    }

    const hash = window.location.hash.slice(1);
    if (hash === 'active') {
        activeFilter = true;
        document.querySelector('a[href="shops.html#active"]')?.classList.add('summary-card-active');
    }

    try {
        [_shops, _users] = await Promise.all([
            api.get('/api/shops'),
            api.get('/api/users'),
        ]);
    } catch (err) {
        showToast('Failed to load shops: ' + err.message, 'error');
        _shops = []; _users = [];
    }

    renderShopStats();
    renderShopCards();

    if (hash === 'shopsGrid' || hash === 'active') {
        document.getElementById('shopsGrid')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    document.getElementById('addShopBtn')?.addEventListener('click', openAddShop);
    document.getElementById('saveShopBtn')?.addEventListener('click', saveShop);
});
