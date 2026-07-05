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
        const help = document.getElementById('forgotHelp');
        if (help) help.style.display = help.style.display === 'none' ? 'block' : 'none';
    });
});
