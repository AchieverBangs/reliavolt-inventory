// ===== CONSTANTS =====
const CURRENCY = 'Le';
const LOW_STOCK_THRESHOLD = 10;

// ===== AUTH =====
function checkAuth() {
    const publicPages = ['index.html', '/'];
    const currentPage = window.location.pathname.split('/').pop() || 'index.html';
    const payload = getTokenPayload();

    if (!payload && !publicPages.includes(currentPage) && currentPage !== '') {
        window.location.href = 'index.html';
        return;
    }

    if (payload && getCurrentUserRole() === 'Delivery Person') {
        const allowed = ['index.html', 'dashboard.html', 'delivery.html', ''];
        if (!allowed.includes(currentPage)) {
            window.location.href = 'delivery.html';
        }
    }
}

function getCurrentUserRole() {
    return getTokenPayload()?.role || '';
}

function getCurrentUserName() {
    return getTokenPayload()?.name || '';
}

function getCurrentUsername() {
    return getTokenPayload()?.username || '';
}

function getCurrentUserShopId() {
    return getTokenPayload()?.shopId || null;
}

function isAdmin() {
    return getCurrentUserRole() === 'Admin';
}

function logout() {
    clearToken();
    window.location.href = 'index.html';
}

// ===== FORMATTERS =====
function formatCurrency(amount) {
    const currency = localStorage.getItem('rv_currency') || CURRENCY;
    return `${currency} ${Number(amount).toLocaleString('en-US')}`;
}

function formatDate(dateStr) {
    if (!dateStr) return '—';
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatDateTime(dateStr) {
    if (!dateStr) return '—';
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
        + ' ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function getStockStatus(qty) {
    if (qty === 0)                  return { label: 'Out of Stock', cls: 'badge-danger',  rowCls: 'row-out-stock' };
    if (qty <= LOW_STOCK_THRESHOLD) return { label: 'Low Stock',    cls: 'badge-warning', rowCls: 'row-low-stock' };
    return                                 { label: 'In Stock',     cls: 'badge-success', rowCls: '' };
}

function todayStr()          { return new Date().toISOString().split('T')[0]; }

function isSameDay(dateStr, dayStr) { return (dateStr || '').split('T')[0] === dayStr; }

function isSameWeek(dateStr) {
    const d = new Date(dateStr);
    const now = new Date();
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - now.getDay());
    weekStart.setHours(0, 0, 0, 0);
    return d >= weekStart;
}

function isSameMonth(dateStr) {
    const d = new Date(dateStr);
    const now = new Date();
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
}

// ===== THEME =====
function applyTheme() {
    const theme = localStorage.getItem('rv_theme') || 'light';
    document.documentElement.setAttribute('data-theme', theme);
}

// ===== TOAST NOTIFICATIONS =====
function showToast(message, type = 'success') {
    let container = document.getElementById('toastContainer');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toastContainer';
        container.className = 'toast-container';
        document.body.appendChild(container);
    }
    const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `<span>${icons[type] || '📢'}</span><span>${message}</span>`;
    container.appendChild(toast);
    setTimeout(() => {
        toast.style.animation = 'slideIn 0.3s ease reverse';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// ===== CONFIRM DIALOG =====
function showConfirm(title, message, onConfirm) {
    let overlay = document.getElementById('confirmOverlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.className = 'confirm-overlay';
        overlay.id = 'confirmOverlay';
        overlay.innerHTML = `
            <div class="confirm-box">
                <span class="confirm-icon">⚠️</span>
                <h3 id="confirmTitle"></h3>
                <p id="confirmMessage"></p>
                <div class="confirm-actions">
                    <button class="btn btn-secondary" id="confirmCancel">Cancel</button>
                    <button class="btn btn-danger" id="confirmOk">Delete</button>
                </div>
            </div>`;
        document.body.appendChild(overlay);
    }
    document.getElementById('confirmTitle').textContent = title;
    document.getElementById('confirmMessage').textContent = message;
    overlay.classList.add('active');
    const ok     = document.getElementById('confirmOk');
    const cancel = document.getElementById('confirmCancel');
    const cleanup = () => overlay.classList.remove('active');
    ok.onclick     = () => { onConfirm(); cleanup(); };
    cancel.onclick = cleanup;
    overlay.onclick = (e) => { if (e.target === overlay) cleanup(); };
}

// ===== SIDEBAR =====
function initSidebar() {
    const hamburger   = document.getElementById('hamburger');
    const sidebarClose = document.getElementById('sidebarClose');
    const sidebar     = document.getElementById('sidebar');
    let overlay = document.getElementById('sidebarOverlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.className = 'sidebar-overlay';
        overlay.id = 'sidebarOverlay';
        document.body.appendChild(overlay);
    }
    const openSidebar  = () => { sidebar && sidebar.classList.add('open');    overlay.classList.add('active'); };
    const closeSidebar = () => { sidebar && sidebar.classList.remove('open'); overlay.classList.remove('active'); };
    hamburger   && hamburger.addEventListener('click',   openSidebar);
    sidebarClose && sidebarClose.addEventListener('click', closeSidebar);
    overlay.addEventListener('click', closeSidebar);

    const current = window.location.pathname.split('/').pop() || 'dashboard.html';
    document.querySelectorAll('.nav-item').forEach(item => {
        const href = item.getAttribute('href');
        if (href === current) item.classList.add('active');
        else item.classList.remove('active');
        const labelEl = item.querySelector('.nav-label');
        if (labelEl) item.setAttribute('data-tooltip', labelEl.textContent.trim());
    });

    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn && !logoutBtn.querySelector('.logout-label')) {
        logoutBtn.innerHTML = '🚪 <span class="logout-label">Logout</span>';
    }

    if (sidebar) {
        const header = sidebar.querySelector('.sidebar-header');
        if (header && !document.getElementById('sidebarCollapseBtn')) {
            const btn = document.createElement('button');
            btn.id = 'sidebarCollapseBtn';
            btn.className = 'sidebar-collapse-btn';
            btn.setAttribute('aria-label', 'Toggle sidebar');
            btn.textContent = '◀';
            btn.addEventListener('click', toggleSidebarCollapse);
            header.appendChild(btn);
        }
        if (localStorage.getItem('rv_sidebar_collapsed') === 'true') applySidebarCollapse(true);
    }
}

function applySidebarCollapse(collapsed) {
    const sidebar = document.getElementById('sidebar');
    const btn = document.getElementById('sidebarCollapseBtn');
    if (!sidebar) return;
    sidebar.classList.toggle('collapsed', collapsed);
    if (btn) { btn.textContent = collapsed ? '▶' : '◀'; btn.title = collapsed ? 'Expand sidebar' : 'Collapse sidebar'; }
}

function toggleSidebarCollapse() {
    const sidebar = document.getElementById('sidebar');
    if (!sidebar) return;
    const isCollapsed = !sidebar.classList.contains('collapsed');
    applySidebarCollapse(isCollapsed);
    localStorage.setItem('rv_sidebar_collapsed', isCollapsed);
}

// ===== HEADER =====
function initHeader() {
    const dateEl = document.getElementById('currentDate');
    if (dateEl) {
        dateEl.textContent = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    }

    const name = getCurrentUserName() || getCurrentUsername() || 'Admin';
    const role = getCurrentUserRole();

    const userEl   = document.getElementById('currentUser');
    const roleEl   = document.getElementById('userRole');
    const avatarEl = document.getElementById('userAvatar');
    if (userEl)   userEl.textContent   = name;
    if (roleEl)   roleEl.textContent   = role;
    if (avatarEl) avatarEl.textContent = name.split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase();

    document.getElementById('logoutBtn')?.addEventListener('click', logout);
    applyRoleBasedNav();
}

// ===== ROLE-BASED NAV =====
function applyRoleBasedNav() {
    const role     = getCurrentUserRole();
    const admin    = role === 'Admin';
    const isDriver = role === 'Delivery Person';
    document.querySelectorAll('.nav-admin').forEach(el => el.classList.toggle('hidden', !admin));
    if (isDriver) {
        const blocked = ['inventory.html', 'sales.html', 'customers.html', 'reports.html', 'settings.html'];
        document.querySelectorAll('.nav-item').forEach(el => {
            const href = el.getAttribute('href') || '';
            if (blocked.some(b => href === b || href.endsWith('/' + b))) el.classList.add('hidden');
        });
    }
}

// ===== MODAL HELPERS =====
function openModal(id)  { const m = document.getElementById(id); m && m.classList.add('active');    document.body.style.overflow = 'hidden'; }
function closeModal(id) { const m = document.getElementById(id); m && m.classList.remove('active'); document.body.style.overflow = ''; }

function initModals() {
    document.querySelectorAll('.modal-overlay').forEach(overlay => {
        overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(overlay.id); });
    });
    document.querySelectorAll('.modal-close').forEach(btn => {
        btn.addEventListener('click', () => { const m = btn.closest('.modal-overlay'); m && closeModal(m.id); });
    });
}

// ===== MAIN INIT =====
document.addEventListener('DOMContentLoaded', () => {
    checkAuth();
    applyTheme();
    initSidebar();
    initHeader();
    initModals();
});
