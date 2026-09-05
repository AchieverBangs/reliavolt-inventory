const express  = require('express');
const multer   = require('multer');
const ExcelJS  = require('exceljs');
const { Readable } = require('stream');
const pool     = require('../db/pool');
const { verifyToken, requireRole } = require('../middleware/auth');

const router = express.Router();
const STOCK_ROLES = ['Admin', 'Manager', 'Stock Manager'];
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

const PRODUCT_SELECT = `SELECT p.*, s.name AS shop_name FROM products p LEFT JOIN shops s ON s.id = p.shop_id`;

// Cost price (and anything derived from it) is Admin-only — strip it for everyone else.
function hideCost(rowOrRows, role) {
    if (role === 'Admin') return rowOrRows;
    const strip = (r) => { const { cost_price, ...rest } = r; return rest; };
    return Array.isArray(rowOrRows) ? rowOrRows.map(strip) : strip(rowOrRows);
}

// GET /api/products  (scoped to the caller's shop unless Admin; Admin may pass ?shop_id=)
router.get('/', verifyToken, async (req, res) => {
    try {
        let query = PRODUCT_SELECT;
        const vals = [];

        if (req.user.role === 'Admin') {
            if (req.query.shop_id) {
                vals.push(req.query.shop_id);
                query += ` WHERE p.shop_id = $${vals.length}`;
            }
        } else {
            if (!req.user.shopId) return res.json([]);
            vals.push(req.user.shopId);
            query += ` WHERE p.shop_id = $${vals.length}`;
        }

        query += ' ORDER BY p.name';
        const { rows } = await pool.query(query, vals);
        res.json(hideCost(rows, req.user.role));
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/products/summary/by-shop  (Admin only — total products added per shop + grand total)
router.get('/summary/by-shop', verifyToken, requireRole('Admin'), async (req, res) => {
    try {
        const { rows } = await pool.query(
            `SELECT s.id AS shop_id, s.name AS shop_name,
                    COUNT(p.id)::int AS product_count,
                    COALESCE(SUM(p.quantity), 0)::int AS total_quantity,
                    COALESCE(SUM(p.cost_price    * p.quantity), 0)::numeric AS total_cost_value,
                    COALESCE(SUM(p.selling_price * p.quantity), 0)::numeric AS total_selling_value
             FROM shops s
             LEFT JOIN products p ON p.shop_id = s.id
             GROUP BY s.id, s.name
             ORDER BY s.name`
        );
        const grandTotal = rows.reduce((acc, r) => ({
            product_count:       acc.product_count       + r.product_count,
            total_quantity:      acc.total_quantity       + r.total_quantity,
            total_cost_value:    acc.total_cost_value     + Number(r.total_cost_value),
            total_selling_value: acc.total_selling_value  + Number(r.total_selling_value),
        }), { product_count: 0, total_quantity: 0, total_cost_value: 0, total_selling_value: 0 });

        res.json({ shops: rows, grandTotal });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/products/:id
router.get('/:id', verifyToken, async (req, res) => {
    try {
        const { rows } = await pool.query(`${PRODUCT_SELECT} WHERE p.id = $1`, [req.params.id]);
        const product = rows[0];
        if (!product) return res.status(404).json({ error: 'Product not found' });
        if (req.user.role !== 'Admin' && product.shop_id !== req.user.shopId) {
            return res.status(404).json({ error: 'Product not found' });
        }
        res.json(hideCost(product, req.user.role));
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/products  (Admin, Manager, Stock Manager can add; cost_price is ignored unless Admin)
router.post('/', verifyToken, requireRole(...STOCK_ROLES), async (req, res) => {
    const { name, category, brand, selling_price, quantity, icon } = req.body;
    if (!name) return res.status(400).json({ error: 'Product name is required' });
    const cost_price = req.user.role === 'Admin' ? (req.body.cost_price || 0) : 0;

    // Non-admins can only add to their own shop; Admins must specify one
    let shop_id;
    if (req.user.role === 'Admin') {
        shop_id = req.body.shop_id;
        if (!shop_id) return res.status(400).json({ error: 'shop_id is required' });
    } else {
        if (!req.user.shopId) return res.status(400).json({ error: 'Your account has no shop assigned' });
        shop_id = req.user.shopId;
    }

    try {
        const { rows } = await pool.query(
            `INSERT INTO products (name, category, brand, cost_price, selling_price, quantity, icon, shop_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
            [name, category || null, brand || null, cost_price, selling_price || 0, quantity || 0, icon || '📦', shop_id]
        );
        res.status(201).json(hideCost(rows[0], req.user.role));
    } catch (err) {
        if (err.code === '23503') return res.status(400).json({ error: 'shop_id does not exist' });
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/products/import  (Excel/CSV bulk add — same permissions & cost rules as a single add)
router.post('/import', verifyToken, requireRole(...STOCK_ROLES), upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded (field name must be "file")' });

    let shop_id;
    if (req.user.role === 'Admin') {
        shop_id = req.body.shop_id;
        if (!shop_id) return res.status(400).json({ error: 'shop_id is required' });
    } else {
        if (!req.user.shopId) return res.status(400).json({ error: 'Your account has no shop assigned' });
        shop_id = req.user.shopId;
    }

    const cellText = (v) => {
        if (v == null) return '';
        if (typeof v === 'object' && 'text' in v) return String(v.text); // rich text
        if (typeof v === 'object' && v.result !== undefined) return String(v.result); // formula
        return String(v);
    };

    let rows;
    try {
        const workbook = new ExcelJS.Workbook();
        const isCsv = /\.csv$/i.test(req.file.originalname || '');
        if (isCsv) {
            await workbook.csv.read(Readable.from(req.file.buffer));
        } else {
            await workbook.xlsx.load(req.file.buffer);
        }

        const sheet = workbook.worksheets[0];
        if (!sheet) throw new Error('No sheet found');

        const headers = [];
        sheet.getRow(1).eachCell({ includeEmpty: true }, (cell, colNumber) => {
            headers[colNumber] = cellText(cell.value).trim().toLowerCase();
        });

        rows = [];
        sheet.eachRow((row, rowNumber) => {
            if (rowNumber === 1) return;
            const obj = {};
            row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
                if (headers[colNumber]) obj[headers[colNumber]] = cell.value;
            });
            if (Object.values(obj).some(v => v !== null && v !== undefined && v !== '')) rows.push(obj);
        });
    } catch (err) {
        return res.status(400).json({ error: 'Could not read the file — make sure it is a valid .xlsx or .csv file' });
    }

    if (!rows.length) return res.status(400).json({ error: 'The file has no rows to import' });

    const pick = (row, keys) => {
        for (const key of keys) {
            if (row[key] !== undefined && row[key] !== null && row[key] !== '') return cellText(row[key]);
        }
        return undefined;
    };

    const canSeeCost = req.user.role === 'Admin';
    const toImport = [];
    const skipped = [];

    rows.forEach((row, idx) => {
        const name          = String(pick(row, ['name', 'product', 'product name']) || '').trim();
        const sellingRaw     = pick(row, ['selling price', 'sellingprice', 'price']);
        const selling_price = parseFloat(sellingRaw);

        if (!name || isNaN(selling_price)) {
            skipped.push({ row: idx + 2, reason: 'Missing or invalid name / selling price' });
            return;
        }

        const category  = String(pick(row, ['category']) || '').trim() || null;
        const brand     = String(pick(row, ['brand']) || '').trim() || null;
        const quantity  = parseInt(pick(row, ['quantity', 'qty', 'stock'])) || 0;
        const icon      = String(pick(row, ['icon', 'emoji']) || '').trim() || '📦';
        const costRaw   = pick(row, ['cost price', 'costprice', 'cost']);
        const costParsed = parseFloat(costRaw);
        const cost_price = canSeeCost && !isNaN(costParsed) ? costParsed : 0;

        toImport.push({ name, category, brand, cost_price, selling_price, quantity, icon });
    });

    if (!toImport.length) {
        return res.status(400).json({ error: 'No valid rows found to import', skipped });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        for (const p of toImport) {
            await client.query(
                `INSERT INTO products (name, category, brand, cost_price, selling_price, quantity, icon, shop_id)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
                [p.name, p.category, p.brand, p.cost_price, p.selling_price, p.quantity, p.icon, shop_id]
            );
        }
        await client.query('COMMIT');
        res.status(201).json({ imported: toImport.length, skipped, total: rows.length });
    } catch (err) {
        await client.query('ROLLBACK');
        if (err.code === '23503') return res.status(400).json({ error: 'shop_id does not exist' });
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    } finally {
        client.release();
    }
});

// PUT /api/products/:id  (Admin only)
router.put('/:id', verifyToken, requireRole('Admin'), async (req, res) => {
    const { name, category, brand, cost_price, selling_price, quantity, icon, shop_id } = req.body;
    if (!name) return res.status(400).json({ error: 'Product name is required' });

    try {
        const { rows } = await pool.query(
            `UPDATE products SET name=$1, category=$2, brand=$3, cost_price=$4,
             selling_price=$5, quantity=$6, icon=$7, shop_id=COALESCE($8, shop_id) WHERE id=$9 RETURNING *`,
            [name, category || null, brand || null, cost_price || 0, selling_price || 0, quantity || 0, icon || '📦', shop_id || null, req.params.id]
        );
        if (!rows[0]) return res.status(404).json({ error: 'Product not found' });
        res.json(rows[0]);
    } catch (err) {
        if (err.code === '23503') return res.status(400).json({ error: 'shop_id does not exist' });
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// DELETE /api/products/:id  (Admin only)
router.delete('/:id', verifyToken, requireRole('Admin'), async (req, res) => {
    try {
        const { rowCount } = await pool.query('DELETE FROM products WHERE id = $1', [req.params.id]);
        if (!rowCount) return res.status(404).json({ error: 'Product not found' });
        res.json({ message: 'Product deleted' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
