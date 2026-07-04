// ===== API BASE =====
const API_BASE = 'https://reliavolt-inventory-production.up.railway.app';

// ===== TOKEN MANAGEMENT =====
function getToken()      { return localStorage.getItem('rv_token'); }
function setToken(t)     { localStorage.setItem('rv_token', t); }
function clearToken()    { localStorage.removeItem('rv_token'); sessionStorage.clear(); }

function getTokenPayload() {
    const token = getToken();
    if (!token) return null;
    try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        if (payload.exp && payload.exp * 1000 < Date.now()) { clearToken(); return null; }
        return payload;
    } catch { return null; }
}

// ===== FETCH WRAPPER =====
async function apiFetch(path, options = {}) {
    const token = getToken();
    const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    let res;
    try {
        res = await fetch(API_BASE + path, { ...options, headers });
    } catch {
        throw new Error('Cannot reach the server. Make sure the backend is running.');
    }

    if (res.status === 401) {
        if (getToken()) {
            clearToken();
            window.location.href = 'index.html';
            return null;
        }
        throw new Error('Invalid credentials');
    }

    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
}

// ===== API METHODS =====
const api = {
    get:    (path)       => apiFetch(path),
    post:   (path, body) => apiFetch(path, { method: 'POST',   body: JSON.stringify(body) }),
    put:    (path, body) => apiFetch(path, { method: 'PUT',    body: JSON.stringify(body) }),
    patch:  (path, body) => apiFetch(path, { method: 'PATCH',  body: JSON.stringify(body) }),
    delete: (path)       => apiFetch(path, { method: 'DELETE' }),
};
