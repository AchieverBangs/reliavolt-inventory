// ===== LOAD SETTINGS INTO FORM =====
async function loadSettingsForm() {
    let settings = {};
    try {
        settings = await api.get('/api/settings');
    } catch (err) {
        showToast('Could not load settings from server.', 'warning');
    }

    const companyEl  = document.getElementById('settingCompanyName');
    const currencyEl = document.getElementById('settingCurrency');
    const footerEl   = document.getElementById('settingReceiptFooter');

    if (companyEl)  companyEl.value  = settings.company_name    || 'Reliavolt Supply';
    if (currencyEl) currencyEl.value = settings.currency         || 'Le';
    if (footerEl)   footerEl.value   = settings.receipt_footer   || '"We Go For Value" | Thank you for your business!';

    applyThemeHighlight(settings.theme || localStorage.getItem('rv_theme') || 'light');
}

// ===== THEME HIGHLIGHT =====
function applyThemeHighlight(theme) {
    document.querySelectorAll('.theme-option-card').forEach(card => {
        const val        = card.dataset.themeVal;
        const isSelected = val === theme;
        card.classList.toggle('selected', isSelected);

        let badge = card.querySelector('.theme-check');
        if (isSelected) {
            if (!badge) {
                badge = document.createElement('span');
                badge.className  = 'theme-check';
                badge.style.cssText = 'display:inline-block;background:var(--primary);color:#fff;border-radius:50%;width:20px;height:20px;line-height:20px;font-size:12px;margin-top:0.4rem;';
                badge.textContent = '✓';
                card.appendChild(badge);
            }
        } else if (badge) {
            badge.remove();
        }
    });

    const radioId = theme === 'dark' ? 'themeRadioDark' : 'themeRadioLight';
    const radio   = document.getElementById(radioId);
    if (radio) radio.checked = true;
}

// ===== SAVE SETTINGS =====
async function saveSettingsForm() {
    const company_name    = document.getElementById('settingCompanyName').value.trim()   || 'Reliavolt Supply';
    const currency        = document.getElementById('settingCurrency').value              || 'Le';
    const receipt_footer  = document.getElementById('settingReceiptFooter').value.trim() || 'Thank you for your business!';
    const checkedRadio    = document.querySelector('input[name="theme"]:checked');
    const theme           = checkedRadio ? checkedRadio.value : 'light';

    try {
        await api.put('/api/settings', { company_name, currency, receipt_footer, theme });

        // Update local caches used by other pages
        localStorage.setItem('rv_currency',     currency);
        localStorage.setItem('rv_theme',        theme);
        localStorage.setItem('rv_company_name', company_name);

        applyTheme();
        showToast('Settings saved successfully!', 'success');
    } catch (err) {
        showToast('Failed to save settings: ' + err.message, 'error');
    }
}

// ===== INIT =====
document.addEventListener('DOMContentLoaded', () => {
    loadSettingsForm();

    document.getElementById('saveSettingsBtn')?.addEventListener('click', saveSettingsForm);

    document.querySelectorAll('.theme-option-card').forEach(card => {
        card.addEventListener('click', () => {
            const val = card.dataset.themeVal;
            applyThemeHighlight(val);
            document.documentElement.setAttribute('data-theme', val);
        });
    });
});
