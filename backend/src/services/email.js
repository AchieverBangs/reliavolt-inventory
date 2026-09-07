// Sends transactional email via Resend's HTTP API (https://resend.com).
// Requires RESEND_API_KEY and RESEND_FROM (e.g. "Reliavolt Supply <noreply@reliavoltsupply.shop>")
// with a verified sending domain in the Resend dashboard.
const RESEND_API_URL = 'https://api.resend.com/emails';

async function sendEmail({ to, subject, html }) {
    const apiKey = process.env.RESEND_API_KEY;
    const from   = process.env.RESEND_FROM;
    if (!apiKey || !from) {
        throw new Error('RESEND_API_KEY and RESEND_FROM must be set to send email');
    }

    const res = await fetch(RESEND_API_URL, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ from, to, subject, html }),
    });

    if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || `Resend API error (HTTP ${res.status})`);
    }
}

async function sendPasswordReset(toEmail, userName, resetLink) {
    await sendEmail({
        to: toEmail,
        subject: 'Password Reset — Reliavolt Supply',
        html: `
            <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:2rem;">
                <div style="text-align:center;margin-bottom:1.5rem;">
                    <h2 style="color:#1a3a8f;margin:0;">🔑 Password Reset</h2>
                    <p style="color:#dc2626;font-size:0.8rem;font-weight:700;letter-spacing:2px;margin:0.25rem 0 0;">RELIAVOLT SUPPLY</p>
                </div>
                <p>Hi <strong>${userName}</strong>,</p>
                <p>You requested to reset your password for the Reliavolt Supply Inventory System.</p>
                <p>Click the button below to set a new password. This link expires in <strong>1 hour</strong>.</p>
                <div style="text-align:center;margin:2rem 0;">
                    <a href="${resetLink}" style="background:#1a3a8f;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:700;font-size:1rem;display:inline-block;">
                        Reset My Password
                    </a>
                </div>
                <p>Or copy this link into your browser:</p>
                <p style="background:#f1f5f9;padding:0.75rem;border-radius:6px;font-size:0.8rem;word-break:break-all;color:#475569;">${resetLink}</p>
                <p style="font-size:0.85rem;color:#64748b;">If you did not request this, ignore this email — your password remains unchanged.</p>
                <hr style="margin:1.5rem 0;border:none;border-top:1px solid #e2e8f0;">
                <p style="font-size:0.75rem;color:#94a3b8;text-align:center;">Reliavolt Supply &bull; "We Go For Value"</p>
            </div>
        `,
    });
}

module.exports = { sendPasswordReset };
