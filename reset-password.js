document.addEventListener('DOMContentLoaded', () => {
    const token = new URLSearchParams(window.location.search).get('token');

    if (!token) {
        document.getElementById('resetForm').style.display   = 'none';
        document.getElementById('invalidState').style.display = 'block';
        return;
    }

    const resetBtn  = document.getElementById('resetBtn');
    const errorEl   = document.getElementById('resetError');

    async function doReset() {
        const newPw  = document.getElementById('newPassword').value;
        const confPw = document.getElementById('confirmPassword').value;

        errorEl.classList.remove('show');

        if (newPw.length < 6) {
            errorEl.textContent = 'Password must be at least 6 characters.';
            errorEl.classList.add('show');
            return;
        }
        if (newPw !== confPw) {
            errorEl.textContent = 'Passwords do not match.';
            errorEl.classList.add('show');
            return;
        }

        resetBtn.disabled     = true;
        resetBtn.textContent  = 'Saving…';

        try {
            await api.post('/api/auth/reset-password', { token, password: newPw });
            document.getElementById('resetForm').style.display    = 'none';
            document.getElementById('successState').style.display = 'block';
        } catch (err) {
            if (err.message.includes('invalid') || err.message.includes('expired')) {
                document.getElementById('resetForm').style.display    = 'none';
                document.getElementById('invalidState').style.display = 'block';
            } else {
                errorEl.textContent = err.message;
                errorEl.classList.add('show');
            }
        } finally {
            resetBtn.disabled    = false;
            resetBtn.textContent = 'Set New Password';
        }
    }

    resetBtn.addEventListener('click', doReset);
    document.getElementById('confirmPassword').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') doReset();
    });
});
