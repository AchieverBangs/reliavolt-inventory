// ===== STATE =====
let _users = [];
let _shops = [];
let editingUserId = null;
let searchQuery   = '';
let roleFilter    = '';
let statusFilter  = '';

const ROLE_AVATAR_CLASS = {
    'Admin':           'avatar-admin',
    'Manager':         'avatar-manager',
    'Cashier':         'avatar-cashier',
    'Stock Manager':   'avatar-stock',
    'Delivery Person': 'avatar-driver',
};

const ROLE_BADGE_CLASS = {
    'Admin':           'role-admin',
    'Manager':         'role-manager',
    'Cashier':         'role-cashier',
    'Stock Manager':   'role-stock',
    'Delivery Person': 'role-driver',
};

const ROLE_ACCENT_CLASS = {
    'Admin':           'user-accent-admin',
    'Manager':         'user-accent-manager',
    'Cashier':         'user-accent-cashier',
    'Stock Manager':   'user-accent-stock',
    'Delivery Person': 'user-accent-driver',
};

const ROLE_HINTS = {
    'Admin':           'Full system access — can manage users, shops, all data and settings.',
    'Manager':         'Can manage inventory, sales, customers, deliveries and view reports.',
    'Cashier':         'Can record sales, view products and manage customers.',
    'Stock Manager':   'Can manage inventory and stock levels only.',
    'Delivery Person': 'Sees only their assigned shop\'s deliveries; can update delivery status.',
};

// ===== RENDER STATS =====
function renderUserStats() {
    setEl('totalUsers',    _users.length);
    setEl('activeUsers',   _users.filter(u => u.status === 'Active').length);
    setEl('inactiveUsers', _users.filter(u => u.status === 'Inactive').length);
    setEl('shopsCovered',  _shops.filter(s => s.status === 'Active').length);
    setEl('rolesCount',    new Set(_users.map(u => u.role)).size);
}

// ===== RENDER CARDS =====
function renderUserTable() {
    const grid = document.getElementById('usersGrid');
    if (!grid) return;

    const filtered = _users.filter(u => {
        const q           = searchQuery;
        const matchSearch = !q || u.name.toLowerCase().includes(q) || u.username.toLowerCase().includes(q);
        const matchRole   = !roleFilter   || u.role   === roleFilter;
        const matchStatus = !statusFilter || u.status === statusFilter;
        return matchSearch && matchRole && matchStatus;
    });

    setEl('usersCountLabel', `${filtered.length} of ${_users.length} user${_users.length !== 1 ? 's' : ''}`);

    if (!filtered.length) {
        grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1;padding:3rem;">
            <span class="empty-icon">👤</span><p>No users match your filters.</p>
        </div>`;
        return;
    }

    const currentUsername = getCurrentUsername();

    grid.innerHTML = filtered.map(u => {
        const shop      = u.shop_id ? _shops.find(s => s.id === u.shop_id) : null;
        const initials  = u.name.split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase();
        const avatarCls = ROLE_AVATAR_CLASS[u.role]  || 'avatar-cashier';
        const roleCls   = ROLE_BADGE_CLASS[u.role]   || 'role-cashier';
        const accentCls = ROLE_ACCENT_CLASS[u.role]  || 'user-accent-cashier';
        const statusCls = u.status === 'Active' ? 'badge-success' : 'badge-secondary';
        const isSelf    = u.username === currentUsername;

        return `<div class="user-card">
            <div class="user-card-accent ${accentCls}"></div>
            <div class="user-card-body">
                <div class="user-card-top">
                    <div class="user-avatar-circle user-avatar-lg ${avatarCls}">${initials}</div>
                    <div class="user-card-identity">
                        <div class="user-card-name">
                            ${escHtml(u.name)}
                            ${isSelf ? '<span class="uc-you-badge">You</span>' : ''}
                        </div>
                        <div class="user-card-username">@${escHtml(u.username)}</div>
                    </div>
                    <span class="role-badge ${roleCls}">${escHtml(u.role)}</span>
                </div>

                <div class="user-card-info">
                    <div class="uc-info-row">
                        <span class="uc-info-icon">🏪</span>
                        <span class="uc-info-text">${shop ? escHtml(shop.name) : 'All Shops'}</span>
                    </div>
                    ${u.email ? `<div class="uc-info-row">
                        <span class="uc-info-icon">📧</span>
                        <span class="uc-info-text" style="font-size:0.78rem;">${escHtml(u.email)}</span>
                    </div>` : ''}
                    <div class="uc-info-row">
                        <span class="uc-info-icon">📅</span>
                        <span class="uc-info-text">${formatDate(u.created_at)}</span>
                    </div>
                </div>

                <div class="user-card-footer">
                    <span class="badge ${statusCls}">${u.status}</span>
                    <div class="uc-actions">
                        <button class="btn btn-warning btn-sm" onclick="openEditUser(${u.id})">✏️ Edit</button>
                        <button class="btn btn-secondary btn-sm" onclick="openResetPassword(${u.id})" title="Reset password">🔑</button>
                        ${!isSelf ? `<button class="btn btn-danger btn-sm" onclick="deleteUser(${u.id})" title="Delete user">🗑️</button>` : ''}
                    </div>
                </div>
            </div>
        </div>`;
    }).join('');
}

// ===== POPULATE SHOP DROPDOWN =====
function populateShopDropdown() {
    const select = document.getElementById('userShop');
    if (!select) return;
    select.innerHTML = '<option value="">All Shops / No Restriction</option>' +
        _shops.filter(s => s.status !== 'Inactive')
              .map(s => `<option value="${s.id}">${escHtml(s.name)}</option>`).join('');
}

// ===== ROLE HINT =====
function updateRoleHint() {
    const role = document.getElementById('userRoleSelect')?.value;
    const box  = document.getElementById('roleHintBox');
    const txt  = document.getElementById('roleHintText');
    if (!box || !txt) return;
    txt.textContent = ROLE_HINTS[role] || '';
}

// ===== OPEN MODAL =====
function openAddUser() {
    editingUserId = null;
    document.getElementById('userForm').reset();
    document.getElementById('userModalTitle').textContent   = 'Create New User';
    document.getElementById('saveUserBtn').textContent      = 'Create User';
    document.getElementById('userPassword').placeholder    = 'Min. 6 characters';
    document.getElementById('passwordGroup').style.display = '';
    populateShopDropdown();
    updateRoleHint();
    openModal('userModal');
}

function openEditUser(id) {
    const user = _users.find(u => u.id === id);
    if (!user) return;

    editingUserId = id;
    document.getElementById('userModalTitle').textContent   = 'Edit User';
    document.getElementById('saveUserBtn').textContent      = 'Save Changes';
    document.getElementById('userFullName').value           = user.name;
    document.getElementById('userUsername').value           = user.username;
    document.getElementById('userEmail').value              = user.email || '';
    document.getElementById('userPassword').value           = '';
    document.getElementById('userPassword').placeholder    = 'Leave blank to keep current password';
    document.getElementById('userRoleSelect').value         = user.role;
    document.getElementById('userStatus').value             = user.status;
    populateShopDropdown();
    document.getElementById('userShop').value = user.shop_id || '';
    updateRoleHint();
    openModal('userModal');
}

// ===== SAVE USER =====
async function saveUser() {
    const name     = document.getElementById('userFullName').value.trim();
    const username = document.getElementById('userUsername').value.trim().toLowerCase();
    const email    = document.getElementById('userEmail').value.trim() || null;
    const password = document.getElementById('userPassword').value;
    const role     = document.getElementById('userRoleSelect').value;
    const shopId   = document.getElementById('userShop').value ? parseInt(document.getElementById('userShop').value) : null;
    const status   = document.getElementById('userStatus').value;

    if (!name || !username) { showToast('Name and username are required.', 'error'); return; }
    if (!editingUserId && password.length < 6) { showToast('Password must be at least 6 characters.', 'error'); return; }

    const duplicate = _users.find(u => u.username === username && u.id !== editingUserId);
    if (duplicate) { showToast(`Username "@${username}" is already taken.`, 'error'); return; }

    const payload = { name, username, email, role, shop_id: shopId, status, ...(password ? { password } : {}) };

    try {
        if (editingUserId) {
            const updated = await api.put(`/api/users/${editingUserId}`, payload);
            const idx = _users.findIndex(u => u.id === editingUserId);
            if (idx !== -1) _users[idx] = updated;
            showToast(`${name} updated successfully.`, 'success');
        } else {
            const created = await api.post('/api/users', payload);
            _users.push(created);
            showToast(`User @${username} created successfully.`, 'success');
        }
        closeModal('userModal');
        renderUserStats();
        renderUserTable();
    } catch (err) {
        showToast(err.message, 'error');
    }
}

// ===== RESET PASSWORD =====
let resetPasswordUserId = null;

function openResetPassword(id) {
    const user = _users.find(u => u.id === id);
    if (!user) return;
    resetPasswordUserId = id;
    document.getElementById('resetPwUsername').textContent = `Resetting password for: ${user.name} (@${user.username})`;
    document.getElementById('resetPwNew').value     = '';
    document.getElementById('resetPwConfirm').value = '';
    openModal('resetPwModal');
}

async function saveResetPassword() {
    const newPw     = document.getElementById('resetPwNew').value;
    const confirmPw = document.getElementById('resetPwConfirm').value;

    if (newPw.length < 6)       { showToast('Password must be at least 6 characters.', 'error'); return; }
    if (newPw !== confirmPw)    { showToast('Passwords do not match.', 'error'); return; }

    const user = _users.find(u => u.id === resetPasswordUserId);
    if (!user) return;

    try {
        await api.put(`/api/users/${resetPasswordUserId}`, {
            name: user.name, username: user.username,
            role: user.role, shop_id: user.shop_id, status: user.status,
            password: newPw,
        });
        closeModal('resetPwModal');
        showToast(`Password for ${user.name} has been reset.`, 'success');
    } catch (err) {
        showToast(err.message, 'error');
    }
}

// ===== DELETE USER =====
async function deleteUser(id) {
    const user = _users.find(u => u.id === id);
    if (!user) return;

    if (user.username === getCurrentUsername()) {
        showToast('You cannot delete your own account.', 'error');
        return;
    }

    showConfirm('Delete User', `Remove "${user.name}" (@${user.username})? They will no longer be able to log in.`, async () => {
        try {
            await api.delete(`/api/users/${id}`);
            _users = _users.filter(u => u.id !== id);
            showToast(`${user.name} has been removed.`, 'warning');
            renderUserStats();
            renderUserTable();
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
    if (hash === 'active' || hash === 'inactive') {
        statusFilter = hash.charAt(0).toUpperCase() + hash.slice(1);
        const statusSelect = document.getElementById('statusFilter');
        if (statusSelect) statusSelect.value = statusFilter;
        document.querySelector(`a[href="users.html#${hash}"]`)?.classList.add('usp-active');
    }

    try {
        [_users, _shops] = await Promise.all([
            api.get('/api/users'),
            api.get('/api/shops'),
        ]);
    } catch (err) {
        showToast('Failed to load users: ' + err.message, 'error');
        _users = []; _shops = [];
    }

    renderUserStats();
    renderUserTable();

    if (hash === 'active' || hash === 'inactive' || hash === 'usersGrid') {
        document.getElementById('usersGrid')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    document.getElementById('searchUser')?.addEventListener('input', e => {
        searchQuery = e.target.value.toLowerCase().trim();
        renderUserTable();
    });

    document.getElementById('roleFilter')?.addEventListener('change', e => {
        roleFilter = e.target.value;
        renderUserTable();
    });

    document.getElementById('statusFilter')?.addEventListener('change', e => {
        statusFilter = e.target.value;
        renderUserTable();
    });

    document.getElementById('addUserBtn')?.addEventListener('click', openAddUser);
    document.getElementById('saveUserBtn')?.addEventListener('click', saveUser);
    document.getElementById('saveResetPwBtn')?.addEventListener('click', saveResetPassword);
    document.getElementById('userRoleSelect')?.addEventListener('change', updateRoleHint);
});
