const nodemailer = require('nodemailer');

function createTransporter() {
    return nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASS,
        },
    });
}

async function sendPasswordReset(toEmail, userName, resetLink) {
    const transporter = createTransporter();
    await transporter.sendMail({
        from: `"Reliavolt Supply" <${process.env.EMAIL_USER}>`,
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
