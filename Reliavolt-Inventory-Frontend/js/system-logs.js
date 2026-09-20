// ===== STATE =====
let _logs = [];
let searchQuery   = '';
let actionFilter  = '';
let entityFilter  = '';

const ACTION_BADGE = {
    create: 'badge-success',
    update: 'badge-warning',
    delete: 'badge-danger',
};

const ENTITY_LABEL = {
    product:  '📦 Product',
    sale:     '🛒 Sale',
    customer: '👥 Customer',
    user:     '👤 User',
    shop:     '🏪 Shop',
    delivery: '🚚 Delivery',
    settings: '⚙️ Settings',
};

// ===== RENDER =====
function renderLogTable() {
    const tbody = document.getElementById('logTableBody');
    if (!tbody) return;

    const filtered = _logs.filter(l => {
        const q = searchQuery;
        const matchSearch = !q ||
            (l.description || '').toLowerCase().includes(q) ||
            (l.name || '').toLowerCase().includes(q) ||
            (l.username || '').toLowerCase().includes(q);
        const matchAction = !actionFilter || l.action === actionFilter;
        const matchEntity = !entityFilter || l.entity_type === entityFilter;
        return matchSearch && matchAction && matchEntity;
    });

    setEl('logCountLabel', `${filtered.length} of ${_logs.length} event${_logs.length !== 1 ? 's' : ''}`);

    if (!filtered.length) {
        tbody.innerHTML = `<tr><td colspan="5"><div class="empty-state"><span class="empty-icon">🗂️</span><p>No matching activity found.</p></div></td></tr>`;
        return;
    }

    tbody.innerHTML = filtered.map(l => `<tr>
        <td>${formatDateTime(l.created_at)}</td>
        <td><strong>${escHtml(l.name || l.username || 'System')}</strong>${l.role ? ` <span style="color:var(--text-light);font-size:0.78rem;">(${escHtml(l.role)})</span>` : ''}</td>
        <td><span class="badge ${ACTION_BADGE[l.action] || 'badge-secondary'}">${escHtml(l.action)}</span></td>
        <td>${ENTITY_LABEL[l.entity_type] || escHtml(l.entity_type)}</td>
        <td>${escHtml(l.description || '—')}</td>
    </tr>`).join('');
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

    try {
        _logs = await api.get('/api/activity?limit=500');
    } catch (err) {
        showToast('Failed to load system logs: ' + err.message, 'error');
        _logs = [];
    }

    renderLogTable();

    document.getElementById('searchLog')?.addEventListener('input', e => {
        searchQuery = e.target.value.toLowerCase().trim();
        renderLogTable();
    });

    document.getElementById('actionFilter')?.addEventListener('change', e => {
        actionFilter = e.target.value;
        renderLogTable();
    });

    document.getElementById('entityFilter')?.addEventListener('change', e => {
        entityFilter = e.target.value;
        renderLogTable();
    });
});
