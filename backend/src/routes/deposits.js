const express = require('express');
const multer = require('multer');
const pool = require('../db/pool');
const { verifyToken, requireRole } = require('../middleware/auth');
const router = express.Router();
router.use(verifyToken, requireRole('Admin', 'Manager'));
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 4, fieldSize: 1024 } }).single('receipt');
const scope = req => req.user.role === 'Admin' ? [] : [req.user.shopId, req.user.id];
const where = 'd.shop_id=$1 AND d.created_by=$2';
router.get('/', async (req, res, next) => {
    try {
        const values = scope(req);
        const { rows } = await pool.query(`SELECT d.id, d.amount, d.receipt_number, d.deposit_date::text AS deposit_date,
            d.created_at, d.shop_id, d.receipt_name, s.name AS shop_name, u.name AS recorded_by
            FROM deposits d LEFT JOIN shops s ON s.id=d.shop_id LEFT JOIN users u ON u.id=d.created_by
            ${values.length ? 'WHERE ' + where : ''} ORDER BY d.deposit_date DESC, d.id DESC`, values);
        res.json(rows);
    } catch (err) { next(err); }
});
router.get('/:id/receipt', async (req, res, next) => {
    if (!/^\d+$/.test(req.params.id)) return res.status(400).json({ error: 'Invalid deposit.' });
    try {
        const values = scope(req);
        const { rows } = await pool.query(`SELECT receipt_data, receipt_type FROM deposits d WHERE ${values.length ? where + ' AND ' : ''}d.id=$${values.length + 1}`, [...values, req.params.id]);
        if (!rows.length) return res.status(404).json({ error: 'Receipt not found.' });
        res.set({ 'Content-Type': rows[0].receipt_type, 'Content-Disposition': 'attachment; filename="bank-receipt.' + ({ 'application/pdf': 'pdf', 'image/png': 'png', 'image/jpeg': 'jpg' }[rows[0].receipt_type]) + '"', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
        res.send(rows[0].receipt_data);
    } catch (err) { next(err); }
});
router.post('/', (req, res, next) => upload(req, res, err => {
    if (err) return res.status(400).json({ error: 'Upload one PDF, JPG or PNG receipt, maximum 5 MB.' });
    next();
}), async (req, res, next) => {
    const { amount, receipt_number, deposit_date = new Date().toISOString().slice(0, 10) } = req.body;
    const file = req.file;
    const validFile = file && file.size > 0 && (
        (file.mimetype === 'application/pdf' && file.buffer.subarray(0, 5).toString() === '%PDF-') ||
        (file.mimetype === 'image/png' && file.buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) ||
        (file.mimetype === 'image/jpeg' && file.buffer.subarray(0, 3).equals(Buffer.from([255,216,255]))));
    if (!/^\d{1,12}(\.\d{1,2})?$/.test(String(amount ?? '')) || Number(amount) <= 0
        || typeof receipt_number !== 'string' || !receipt_number.trim() || receipt_number.trim().length > 100
        || typeof deposit_date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(deposit_date)
        || !Number.isFinite(Date.parse(deposit_date)) || new Date(deposit_date).toISOString().slice(0,10) !== deposit_date
        || deposit_date > new Date().toISOString().slice(0,10) || !validFile) {
        return res.status(400).json({ error: 'Enter a positive amount (up to two decimals), receipt number, today or an earlier deposit date, and a PDF, JPG or PNG bank receipt (maximum 5 MB).' });
    }
    const shopId = req.user.role === 'Admin' ? req.body.shop_id : req.user.shopId;
    if (!Number.isSafeInteger(Number(shopId)) || Number(shopId) <= 0) return res.status(400).json({ error: 'A shop must be assigned.' });
    try {
        const { rows } = await pool.query(`INSERT INTO deposits (amount, receipt_number, deposit_date, shop_id, created_by, receipt_name, receipt_type, receipt_data)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, amount, receipt_number, deposit_date::text AS deposit_date, shop_id, created_at, receipt_name`,
            [amount, receipt_number.trim(), deposit_date, shopId, req.user.id, file.originalname.slice(0,255), file.mimetype, file.buffer]);
        res.status(201).json(rows[0]);
    } catch (err) {
        if (err.code === '23505') return res.status(409).json({ error: 'This receipt number has already been recorded for this shop.' });
        if (err.code === '23503') return res.status(400).json({ error: 'Selected shop does not exist.' });
        next(err);
    }
});
module.exports = router;
