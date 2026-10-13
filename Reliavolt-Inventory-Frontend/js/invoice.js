// ===== INVOICE =====
// One shared layout for every sale and credit-sale invoice — the Sales page preview,
// printing right after a sale, and reprinting from Recent Sales or a customer's credit
// history all render through renderInvoiceHtml(), so they always look the same.
// Modelled on the shop's paper invoice book: company header, Name / Address / Date,
// a QTY | DESCRIPTION | UNIT PRICE | AMOUNT table, TOTAL, and signature lines.

const INVOICE_MIN_ROWS = 8; // blank ruled rows pad a short invoice, like the paper book

function invoiceEsc(str) {
    return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Plain grouped number with no currency prefix — the currency is printed once, on TOTAL.
function invoiceAmount(n) {
    return Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });
}

function invoiceDate(d) {
    const date = d ? new Date(d) : new Date();
    return date.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

// data: {
//   settings, invoiceNo, customerName, customerContact, date, paymentMethod,
//   lines: [{ qty, description, unitPrice, amount }],
//   amountPaid (credit only — paid up front), removable (preview only — adds a ✕ per line)
// }
function renderInvoiceHtml(data) {
    const settings = data.settings || {};
    const currency = (settings.currency || localStorage.getItem('rv_currency') || 'Le').toUpperCase();
    const lines    = data.lines || [];
    const total    = lines.reduce((sum, l) => sum + Number(l.amount || 0), 0);
    const phones   = (settings.company_phone || '').split(',').map(p => p.trim()).filter(Boolean);

    const rows = lines.map((l, i) => `<tr>
            <td class="inv-c">${invoiceAmount(l.qty)}</td>
            <td>${invoiceEsc(l.description)}${data.removable ? ` <button type="button" class="inv-remove inv-no-print" data-remove-line="${i}" title="Remove line">&times;</button>` : ''}</td>
            <td class="inv-r">${invoiceAmount(l.unitPrice)}</td>
            <td class="inv-r">${invoiceAmount(l.amount)}</td>
        </tr>`).join('');
    const filler = Array.from({ length: Math.max(0, INVOICE_MIN_ROWS - lines.length) },
        () => `<tr class="inv-blank"><td></td><td></td><td></td><td></td></tr>`).join('');

    let creditBlock = '';
    if (data.paymentMethod === 'Credit') {
        const paid = Math.min(total, Math.max(0, Number(data.amountPaid || 0)));
        creditBlock = `<div class="inv-credit">
            <span>Paid: <strong>${invoiceAmount(paid)}</strong></span>
            <span>Balance on credit: <strong>${invoiceAmount(total - paid)}</strong></span>
        </div>`;
    }

    return `<div class="invoice">
        <div class="inv-head">
            <img src="images/logo.svg" class="inv-logo" alt="">
            <div class="inv-company">${invoiceEsc(settings.company_name || 'Reliavolt Supply')}</div>
            ${settings.company_address ? `<div class="inv-address">${invoiceEsc(settings.company_address)}</div>` : ''}
            ${phones.length ? `<div class="inv-phones">Tel: ${phones.map(invoiceEsc).join(' &nbsp;&bull;&nbsp; ')}</div>` : ''}
        </div>
        <div class="inv-titlebar">
            <span class="inv-title">INVOICE</span>
            <span class="inv-number">No <strong>${invoiceEsc(data.invoiceNo || '—')}</strong></span>
        </div>
        <div class="inv-field"><span class="inv-label">Name:</span><span class="inv-fill">${invoiceEsc(data.customerName || 'Walk-in Customer')}</span></div>
        <div class="inv-fieldrow">
            <div class="inv-field"><span class="inv-label">Address:</span><span class="inv-fill">${invoiceEsc(data.customerContact || '')}</span></div>
            <div class="inv-field inv-date"><span class="inv-label">Date:</span><span class="inv-fill">${invoiceDate(data.date)}</span></div>
        </div>
        <table class="inv-table">
            <thead><tr><th class="inv-qty">QTY.</th><th>DESCRIPTION</th><th class="inv-price">UNIT<br>PRICE</th><th class="inv-amt">AMOUNT</th></tr></thead>
            <tbody>${rows}${filler}</tbody>
        </table>
        <div class="inv-foot">
            <div class="inv-note">${invoiceEsc(settings.receipt_footer || '')}${data.paymentMethod ? `<div class="inv-pay">Payment: ${invoiceEsc(data.paymentMethod)}</div>` : ''}</div>
            <div class="inv-total"><span>TOTAL ${invoiceEsc(currency)}</span><strong>${invoiceAmount(total)}</strong></div>
        </div>
        ${creditBlock}
        <div class="inv-sign">
            <span>Manager's sign: <span class="inv-sign-line"></span></span>
            <span>Customer's sign: <span class="inv-sign-line"></span></span>
        </div>
    </div>`;
}

// Turn the rows of GET /api/sales/invoice/:invoiceNo into renderInvoiceHtml() data.
function invoiceDataFromLines(invoice, settings) {
    const lines = invoice.lines || [];
    const first = lines[0] || {};
    const credit = lines.reduce((sum, l) => sum + Number(l.credit_amount || 0), 0);
    const total  = lines.reduce((sum, l) => sum + Number(l.total || 0), 0);
    return {
        settings,
        invoiceNo:       invoice.invoice_no,
        customerName:    first.customer_name,
        customerContact: first.customer_address || first.customer_phone || '',
        date:            first.sale_date,
        paymentMethod:   first.payment_method,
        amountPaid:      total - credit,
        lines: lines.map(l => ({ qty: l.qty, description: l.product_name, unitPrice: l.unit_price, amount: l.total })),
    };
}

// Same temporary-print-area pattern as printCreditHistory() in credit.js.
function printInvoiceHtml(html) {
    document.getElementById('invoicePrintArea')?.remove();
    const area = document.createElement('div');
    area.id = 'invoicePrintArea';
    area.innerHTML = html;
    document.body.appendChild(area);
    document.body.classList.add('invoice-printing');

    let cleaned = false;
    const cleanup = () => {
        if (cleaned) return;
        cleaned = true;
        document.body.classList.remove('invoice-printing');
        area.remove();
        window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup);
    setTimeout(cleanup, 15000); // safety net for browsers that don't fire afterprint

    // Let the logo load before the print dialog snapshots the page.
    const img = area.querySelector('img');
    if (img && !img.complete) {
        img.addEventListener('load', () => window.print(), { once: true });
        img.addEventListener('error', () => window.print(), { once: true });
    } else {
        window.print();
    }
}

// Fetch an already-recorded invoice and print it (Recent Sales / credit history reprint).
async function printInvoiceByNo(invoiceNo) {
    try {
        const [invoice, settings] = await Promise.all([
            api.get(`/api/sales/invoice/${encodeURIComponent(invoiceNo)}`),
            api.get('/api/settings').catch(() => ({})),
        ]);
        printInvoiceHtml(renderInvoiceHtml(invoiceDataFromLines(invoice, settings)));
    } catch (err) {
        showToast('Could not load invoice: ' + err.message, 'error');
    }
}
