document.addEventListener('DOMContentLoaded', () => {
    if (getTokenPayload()) {
        window.location.href = 'dashboard.html';
        return;
    }

    const errorEl  = document.getElementById('loginError');
    const loginBtn = document.getElementById('loginBtn');

    async function doLogin() {
        const username = document.getElementById('username').value.trim();
        const password = document.getElementById('password').value;

        if (!username || !password) {
            errorEl.textContent = 'Please enter both username and password.';
            errorEl.classList.add('show');
            return;
        }

        loginBtn.disabled = true;
        loginBtn.textContent = 'Signing in…';
        errorEl.classList.remove('show');

        try {
            const data = await api.post('/api/auth/login', { username, password });
            setToken(data.token);

            // Cache currency and theme for fast access
            const settings = await api.get('/api/settings').catch(() => null);
            if (settings) {
                localStorage.setItem('rv_currency',     settings.currency       || 'Le');
                localStorage.setItem('rv_theme',        settings.theme          || 'light');
                localStorage.setItem('rv_company_name', settings.company_name   || 'Reliavolt Supply');
            }

            window.location.href = 'dashboard.html';
        } catch (err) {
            errorEl.textContent = err.message.includes('credentials')
                ? 'Invalid username or password.'
                : err.message;
            errorEl.classList.add('show');
            document.getElementById('password').value = '';
            document.getElementById('password').focus();
        } finally {
            loginBtn.disabled = false;
            loginBtn.textContent = 'Sign In →';
        }
    }

    loginBtn.addEventListener('click', doLogin);
    document.getElementById('password').addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); });
    document.getElementById('username').addEventListener('keydown', (e) => { if (e.key === 'Enter') document.getElementById('password').focus(); });

    document.getElementById('forgotBtn')?.addEventListener('click', () => {
        const section = document.getElementById('forgotSection');
        if (section) section.style.display = section.style.display === 'none' ? 'block' : 'none';
    });

    document.getElementById('forgotSendBtn')?.addEventListener('click', async () => {
        const email   = document.getElementById('forgotEmail').value.trim();
        const msgEl   = document.getElementById('forgotMsg');
        const sendBtn = document.getElementById('forgotSendBtn');
        if (!email) { showForgotMsg('Please enter your email address.', false); return; }

        sendBtn.disabled = true;
        sendBtn.textContent = 'Sending…';
        try {
            const data = await api.post('/api/auth/forgot-password', { email });
            showForgotMsg(data.message, true);
        } catch (err) {
            showForgotMsg(err.message, false);
        } finally {
            sendBtn.disabled = false;
            sendBtn.textContent = 'Send Link';
        }
    });

    function showForgotMsg(text, success) {
        const el = document.getElementById('forgotMsg');
        if (!el) return;
        el.textContent = text;
        el.style.display = 'block';
        el.style.background  = success ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)';
        el.style.color       = success ? '#15803d' : '#dc2626';
        el.style.border      = success ? '1px solid rgba(34,197,94,0.3)' : '1px solid rgba(239,68,68,0.3)';
    }
});
