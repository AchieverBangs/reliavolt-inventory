const express = require('express');
const pool = require('../db/pool');
const { verifyToken, requireRole } = require('../middleware/auth');
const router = express.Router();
router.use(verifyToken, requireRole('Admin', 'Manager', 'Cashier', 'Stock Manager'));
router.get('/', async (req, res, next) => {
 try {
  const scoped = req.user.role !== 'Admin';
  if (scoped && !req.user.shopId) return res.json([]);
  const { rows } = await pool.query('SELECT e.*, e.expense_date::text AS expense_date, s.name AS shop_name, u.name AS recorded_by FROM expenditures e LEFT JOIN shops s ON s.id=e.shop_id LEFT JOIN users u ON u.id=e.created_by ' + (scoped ? 'WHERE e.shop_id=$1 ' : '') + 'ORDER BY e.expense_date DESC, e.id DESC', scoped ? [req.user.shopId] : []);
  res.json(rows);
 } catch (err) { next(err); }
});
router.post('/', async (req, res, next) => {
 const { expense_date, description, category = 'General', amount } = req.body;
 const amountText = String(amount ?? '');
 if (typeof expense_date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(expense_date)
  || !Number.isFinite(Date.parse(expense_date)) || new Date(expense_date).toISOString().slice(0,10) !== expense_date
  || typeof description !== 'string' || !description.trim() || description.trim().length > 500
  || typeof category !== 'string' || !category.trim() || category.trim().length > 100
  || !/^\d{1,12}(\.\d{1,2})?$/.test(amountText) || Number(amountText) <= 0) {
  return res.status(400).json({ error: 'Enter a valid date, description, category and positive amount with up to two decimal places.' });
 }
 const shopId = req.user.role === 'Admin' ? req.body.shop_id : req.user.shopId;
 if (!Number.isSafeInteger(Number(shopId)) || Number(shopId) <= 0) return res.status(400).json({ error: 'A shop must be assigned.' });
 try {
  const { rows } = await pool.query('INSERT INTO expenditures (expense_date, description, category, amount, shop_id, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *, expense_date::text AS expense_date', [expense_date, description.trim(), category.trim(), amountText, shopId, req.user.id]);
  res.status(201).json(rows[0]);
 } catch (err) {
  if (err.code === '23503') return res.status(400).json({ error: 'Selected shop does not exist.' });
  next(err);
 }
});
module.exports = router;
