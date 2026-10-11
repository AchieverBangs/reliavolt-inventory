const express   = require('express');
const rateLimit = require('express-rate-limit');
const Anthropic = require('@anthropic-ai/sdk');
const pool      = require('../db/pool');
const { verifyToken, requireRole } = require('../middleware/auth');

const router = express.Router();
const ASK_ROLES = ['Admin', 'Manager', 'Cashier', 'Stock Manager'];

// Each message costs real money (an Anthropic API call) — cap per-user, not per-IP,
// since a whole shop can share one network connection. A real back-and-forth chat burns
// through more messages than one-off questions did, so this is a bit more generous.
const askLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 40,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => String(req.user?.id || req.ip),
    message: { error: 'Too many messages in a short time. Please wait a few minutes and try again.' },
});

// How much prior conversation the client may send back as context. Keeps cost and abuse
// surface bounded — this is a quick assistant, not an unlimited chat log.
const MAX_HISTORY_TURNS = 12;
const MAX_MESSAGE_CHARS = 2000;

// Turns a client-supplied history array into clean {role, content} messages, dropping
// anything malformed rather than trusting it — this becomes part of the prompt sent to
// Claude, so it's untrusted input same as the question itself.
function sanitizeHistory(history) {
    if (!Array.isArray(history)) return [];
    return history
        .filter(h => h && (h.role === 'user' || h.role === 'assistant') && typeof h.content === 'string' && h.content.trim())
        .slice(-MAX_HISTORY_TURNS)
        .map(h => ({ role: h.role, content: h.content.trim().slice(0, MAX_MESSAGE_CHARS) }));
}

const client = process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;
// Sonnet 5 — stronger reasoning than Haiku for a business assistant that now spans shop
// comparisons, staff, and commission settlement status, at roughly 2x the cost per question.
const MODEL = process.env.AI_QUERY_MODEL || 'claude-sonnet-5';

// GET /api/ai/status — reveals nothing sensitive (no key value, just whether one is
// present and roughly well-formed), so it's safe without auth. Lets a deploy be checked
// directly instead of guessing from the Railway dashboard.
router.get('/status', (req, res) => {
    const key = process.env.ANTHROPIC_API_KEY || '';
    res.json({
        configured: !!client,
        keyLength: key.length,
        looksLikeAnthropicKey: key.startsWith('sk-ant-'),
    });
});

// ===== TOOLS — each is a narrow, parameterized query. Claude picks which to call and
// with what arguments, but shop-scoping and cost/profit visibility are enforced here in
// code from the caller's real role/shop, never from anything Claude sends — so a question
// can't be phrased in a way that leaks another shop's data or a non-Admin's cost/profit.
//
// Role is enforced at the tool-list level, not just inside each tool: TOOLS_ADMIN is only
// ever added to the request for an Admin caller, so a Manager/Cashier/Stock Manager isn't
// just told not to ask about other shops, company-wide staff, or system activity — Claude
// is never given a way to look any of that up for them in the first place. =====

const TOOLS_BASE = [
    {
        name: 'get_product_stock',
        description: "Look up current stock, category, and selling price for products matching a name (partial match, case-insensitive). Use this for questions like 'how many X do we have' or 'what's the price of X'.",
        input_schema: {
            type: 'object',
            properties: {
                product_name: { type: 'string', description: 'Full or partial product name to search for' },
                shop_name: { type: 'string', description: "Admin only: restrict to one shop by name, e.g. 'Bo'. Ignored for non-Admin callers, who are always scoped to their own shop." },
            },
            required: ['product_name'],
        },
    },
    {
        name: 'list_low_stock',
        description: "List products that are low in stock (10 units or fewer) or completely out of stock. Use this for questions like 'what's running low' or 'what do we need to restock'.",
        input_schema: {
            type: 'object',
            properties: {
                shop_name: { type: 'string', description: "Admin only: restrict to one shop by name. Ignored for non-Admin callers, who are always scoped to their own shop." },
            },
        },
    },
    {
        name: 'get_sales_summary',
        description: "Get total units sold, revenue, and transaction count over a date range, optionally filtered to one product and/or (Admin only) one shop. Use this for questions like 'how many X did we sell last month', 'what was our revenue this week', or 'what were August sales for the Bo shop'. Dates are YYYY-MM-DD.",
        input_schema: {
            type: 'object',
            properties: {
                from: { type: 'string', description: 'Start date, YYYY-MM-DD, inclusive' },
                to: { type: 'string', description: 'End date, YYYY-MM-DD, inclusive' },
                product_name: { type: 'string', description: 'Optional: restrict to products matching this name (partial match)' },
                shop_name: { type: 'string', description: "Admin only: restrict to one shop by name, e.g. 'Bo'. Ignored for non-Admin callers, who are always scoped to their own shop." },
            },
            required: ['from', 'to'],
        },
    },
    {
        name: 'get_top_sellers',
        description: "Get the best-selling products by quantity over a date range, optionally restricted (Admin only) to one shop. Use this for questions like 'what's our top seller this month' or 'top sellers at the Bo shop'. Dates are YYYY-MM-DD.",
        input_schema: {
            type: 'object',
            properties: {
                from: { type: 'string', description: 'Start date, YYYY-MM-DD, inclusive' },
                to: { type: 'string', description: 'End date, YYYY-MM-DD, inclusive' },
                limit: { type: 'integer', description: 'How many top products to return (default 5)' },
                shop_name: { type: 'string', description: "Admin only: restrict to one shop by name. Ignored for non-Admin callers, who are always scoped to their own shop." },
            },
            required: ['from', 'to'],
        },
    },
    {
        name: 'get_commission_summary',
        description: "Get commission earned over a date range. A non-Admin caller only ever sees their own commission, regardless of any name given. An Admin may optionally look up one staff member by name, or omit it to see everyone. Dates are YYYY-MM-DD.",
        input_schema: {
            type: 'object',
            properties: {
                from: { type: 'string', description: 'Start date, YYYY-MM-DD, inclusive' },
                to: { type: 'string', description: 'End date, YYYY-MM-DD, inclusive' },
                staff_name: { type: 'string', description: 'Optional, Admin only: restrict to one staff member by name' },
            },
            required: ['from', 'to'],
        },
    },
    {
        name: 'get_stock_history',
        description: "Get the full stock picture for a product: how many units were ever added in total (initial stock plus every restock), how many have been sold in total, and how many remain right now. Use this for questions like 'how many X have we added in total' or 'how many X have we sold overall' as opposed to sales in a specific period.",
        input_schema: {
            type: 'object',
            properties: {
                product_name: { type: 'string', description: 'Full or partial product name to search for' },
                shop_name: { type: 'string', description: "Admin only: restrict to one shop by name. Ignored for non-Admin callers, who are always scoped to their own shop." },
            },
            required: ['product_name'],
        },
    },
    {
        name: 'find_sales',
        description: "List individual sales (receipts) with optional filters: date range, product, customer, receipt number, payment method (e.g. 'Cash', 'Credit'), or the staff member who recorded it. Use this for questions like 'show me today's sales', 'what did John buy', 'find receipt R-1234', or 'which sales were on credit this week'. Dates are YYYY-MM-DD.",
        input_schema: {
            type: 'object',
            properties: {
                from: { type: 'string', description: 'Optional start date, YYYY-MM-DD, inclusive' },
                to: { type: 'string', description: 'Optional end date, YYYY-MM-DD, inclusive' },
                product_name: { type: 'string', description: 'Optional: partial product name' },
                customer_name: { type: 'string', description: 'Optional: partial customer name' },
                receipt_no: { type: 'string', description: 'Optional: full or partial receipt number' },
                payment_method: { type: 'string', description: 'Optional: payment method, e.g. Cash, Credit' },
                staff_name: { type: 'string', description: 'Optional: partial name of the staff member who recorded the sale' },
                limit: { type: 'integer', description: 'How many to return (default 20, max 50), newest first' },
                shop_name: { type: 'string', description: "Admin only: restrict to one shop by name. Ignored for non-Admin callers, who are always scoped to their own shop." },
            },
        },
    },
    {
        name: 'get_sales_breakdown',
        description: "Break sales down over a date range, grouped by one dimension: 'day', 'week', 'month', 'payment_method', 'category', 'staff' (who recorded the sale), 'customer', or 'shop' (Admin only). Use this for trends and comparisons, e.g. 'which day was busiest this week', 'sales by month this year', 'cash vs credit', 'which category sells most', 'which cashier sold the most', 'who are our best customers'. Counts every sale, and shows separately how much of it is still unpaid credit. Dates are YYYY-MM-DD.",
        input_schema: {
            type: 'object',
            properties: {
                from: { type: 'string', description: 'Start date, YYYY-MM-DD, inclusive' },
                to: { type: 'string', description: 'End date, YYYY-MM-DD, inclusive' },
                group_by: { type: 'string', enum: ['day', 'week', 'month', 'payment_method', 'category', 'staff', 'customer', 'shop'] },
                product_name: { type: 'string', description: 'Optional: restrict to products matching this name' },
                shop_name: { type: 'string', description: "Admin only: restrict to one shop by name. Ignored for non-Admin callers, who are always scoped to their own shop." },
            },
            required: ['from', 'to', 'group_by'],
        },
    },
    {
        name: 'get_customers',
        description: "Look up customers by name or phone (or list all if no search given), with their phone, address, credit balance owed, number of purchases, total spent, and last purchase date. Use this for questions like 'what's John's phone number', 'who are our customers', or 'when did Mary last buy something'.",
        input_schema: {
            type: 'object',
            properties: {
                search: { type: 'string', description: 'Optional: partial customer name or phone number' },
                limit: { type: 'integer', description: 'How many to return (default 20, max 50)' },
                shop_name: { type: 'string', description: "Admin only: restrict to one shop by name. Ignored for non-Admin callers, who are always scoped to their own shop." },
            },
        },
    },
    {
        name: 'get_credit_overview',
        description: "Who owes us money: every customer with an outstanding credit balance (largest first), the total owed, and credit repayments received over an optional date range. Use this for questions like 'who owes us money', 'how much credit is outstanding', or 'how much credit was paid back this month'.",
        input_schema: {
            type: 'object',
            properties: {
                from: { type: 'string', description: 'Optional start date for repayments received, YYYY-MM-DD' },
                to: { type: 'string', description: 'Optional end date for repayments received, YYYY-MM-DD' },
                shop_name: { type: 'string', description: "Admin only: restrict to one shop by name. Ignored for non-Admin callers, who are always scoped to their own shop." },
            },
        },
    },
    {
        name: 'get_customer_history',
        description: "Full history for one customer: every purchase (product, qty, total, payment method, credit still unpaid) and every credit repayment they made. Use this for questions like 'what has John bought from us' or 'show me Mary's credit history'.",
        input_schema: {
            type: 'object',
            properties: {
                customer_name: { type: 'string', description: 'Full or partial customer name' },
                shop_name: { type: 'string', description: "Admin only: restrict to one shop by name. Ignored for non-Admin callers, who are always scoped to their own shop." },
            },
            required: ['customer_name'],
        },
    },
    {
        name: 'get_stock_movements',
        description: "The stock movement log: every initial stock entry, restock, manual adjustment, and sale deduction, with who did it, when, and the balance afterwards. Filter by product, date range, and/or movement type. Use this for questions like 'when did we last restock X', 'how much stock did we receive this month', or 'who adjusted the stock of Y'. Dates are YYYY-MM-DD.",
        input_schema: {
            type: 'object',
            properties: {
                product_name: { type: 'string', description: 'Optional: partial product name' },
                from: { type: 'string', description: 'Optional start date, YYYY-MM-DD' },
                to: { type: 'string', description: 'Optional end date, YYYY-MM-DD' },
                type: { type: 'string', enum: ['initial', 'restock', 'adjustment', 'sale'], description: 'Optional: only this movement type' },
                limit: { type: 'integer', description: 'How many to return (default 25, max 60), newest first' },
                shop_name: { type: 'string', description: "Admin only: restrict to one shop by name. Ignored for non-Admin callers, who are always scoped to their own shop." },
            },
        },
    },
    {
        name: 'get_deliveries',
        description: "List deliveries and stock transfers (customer deliveries and shop-to-shop transfers) with status, destination, driver, total, date, and items. Filter by status (e.g. 'Pending', 'Delivered'), date range, or recipient. Use this for questions like 'what deliveries are pending' or 'what did we send to the Bo shop'. Dates are YYYY-MM-DD.",
        input_schema: {
            type: 'object',
            properties: {
                status: { type: 'string', description: 'Optional: delivery status, e.g. Pending, Delivered' },
                from: { type: 'string', description: 'Optional start date, YYYY-MM-DD' },
                to: { type: 'string', description: 'Optional end date, YYYY-MM-DD' },
                recipient: { type: 'string', description: 'Optional: partial recipient or destination shop name' },
                limit: { type: 'integer', description: 'How many to return (default 15, max 40), newest first' },
                shop_name: { type: 'string', description: "Admin only: restrict to deliveries sent from one shop. Ignored for non-Admin callers, who are always scoped to their own shop." },
            },
        },
    },
    {
        name: 'get_inventory_summary',
        description: "Inventory grouped by category or brand: number of products, total units in stock, out-of-stock count, and stock value. Use this for questions like 'how much stock do we have in total', 'what's our inventory worth', 'which categories do we carry', or 'how many cables do we have overall'.",
        input_schema: {
            type: 'object',
            properties: {
                group_by: { type: 'string', enum: ['category', 'brand'], description: 'Default category' },
                shop_name: { type: 'string', description: "Admin only: restrict to one shop by name. Ignored for non-Admin callers, who are always scoped to their own shop." },
            },
        },
    },
];

// ===== ADMIN-ONLY TOOLS — company-wide visibility across all shops and staff. Never
// included in the request unless the caller's role is Admin. =====

const TOOLS_ADMIN = [
    {
        name: 'get_shop_overview',
        description: "Compare shops: product count, total stock quantity, and total inventory value (cost and selling) per shop, or for one shop by name. Use this for questions like 'how is Shop B doing' or 'which shop has the most stock'.",
        input_schema: {
            type: 'object',
            properties: {
                shop_name: { type: 'string', description: 'Optional: restrict to one shop matching this name' },
            },
        },
    },
    {
        name: 'get_staff_list',
        description: "List staff members with their role, shop, and active/inactive status. Use this for questions like 'who works at Shop A' or 'how many cashiers do we have'.",
        input_schema: {
            type: 'object',
            properties: {
                shop_name: { type: 'string', description: 'Optional: restrict to staff at one shop matching this name' },
            },
        },
    },
    {
        name: 'get_recent_activity',
        description: "Get the most recent entries from the system activity log (who created, updated, or deleted what, and when). Use this for questions like 'what changed today' or 'who added a new product recently'.",
        input_schema: {
            type: 'object',
            properties: {
                limit: { type: 'integer', description: 'How many recent entries to return (default 10, max 30)' },
            },
        },
    },
    {
        name: 'get_commission_settlement_status',
        description: "For one calendar month, show every staff member's commission total and whether they've confirmed receiving it and whether an Admin has confirmed paying it. Use this for questions like 'who hasn't been paid their commission for September' or 'has Samuel confirmed his commission yet'.",
        input_schema: {
            type: 'object',
            properties: {
                year: { type: 'integer', description: 'e.g. 2026' },
                month: { type: 'integer', description: '1-12' },
            },
            required: ['year', 'month'],
        },
    },
    {
        name: 'get_login_history',
        description: "Recent staff logins: who logged in and when, optionally for one staff member. Use this for questions like 'who logged in today' or 'when did Samuel last log in'.",
        input_schema: {
            type: 'object',
            properties: {
                staff_name: { type: 'string', description: 'Optional: partial staff name' },
                limit: { type: 'integer', description: 'How many to return (default 20, max 50)' },
            },
        },
    },
];

const ADMIN_ONLY_TOOL_NAMES = new Set(TOOLS_ADMIN.map(t => t.name));

// Non-Admin callers are always pinned to their own shop. An Admin gets no filter (sees
// everything) unless they named one shop by name, in which case it's resolved here — a
// name matching nothing resolves to -1 (no real shop has that id) so the query comes back
// empty instead of silently falling through to "all shops".
// A non-Admin with no shop assigned also resolves to -1: a null here would mean "all
// shops", which is exactly what they must never get.
async function resolveShopId(admin, shopNameInput, ownShopId) {
    if (!admin) return ownShopId || -1;
    if (!shopNameInput) return null;
    const { rows } = await pool.query('SELECT id FROM shops WHERE name ILIKE $1 LIMIT 1', [`%${shopNameInput}%`]);
    return rows[0] ? rows[0].id : -1;
}

// Optional partial-match filter: null when not given, so the `$n IS NULL OR ...` clause skips it.
const like = (v) => (v ? `%${v}%` : null);
const clampLimit = (v, def, max) => Math.min(Math.max(parseInt(v, 10) || def, 1), max);

async function runTool(name, input, req) {
    const admin = req.user.role === 'Admin';

    // Belt-and-braces: even though a non-Admin's request never includes TOOLS_ADMIN in the
    // first place, refuse to execute one of those queries here too, in case that ever
    // changes upstream without this file being updated to match.
    if (!admin && ADMIN_ONLY_TOOL_NAMES.has(name)) {
        throw new Error('This information is only available to Admin accounts.');
    }

    switch (name) {
        case 'get_product_stock': {
            const shopId = await resolveShopId(admin, input.shop_name, req.user.shopId);
            const { rows } = await pool.query(
                `SELECT name, category, quantity, selling_price, cost_price
                 FROM products
                 WHERE name ILIKE $1 AND ($2::int IS NULL OR shop_id = $2)
                 ORDER BY name LIMIT 10`,
                [`%${input.product_name}%`, shopId]
            );
            return rows.map(r => admin ? r : { name: r.name, category: r.category, quantity: r.quantity, selling_price: r.selling_price });
        }

        case 'list_low_stock': {
            const shopId = await resolveShopId(admin, input.shop_name, req.user.shopId);
            const { rows } = await pool.query(
                `SELECT name, category, quantity
                 FROM products
                 WHERE quantity <= 10 AND ($1::int IS NULL OR shop_id = $1)
                 ORDER BY quantity ASC LIMIT 25`,
                [shopId]
            );
            return rows;
        }

        case 'get_sales_summary': {
            const shopId = await resolveShopId(admin, input.shop_name, req.user.shopId);
            const { rows } = await pool.query(
                `SELECT COUNT(*)::int AS transactions,
                        COALESCE(SUM(qty), 0)::int AS total_qty,
                        COALESCE(SUM(total), 0) AS total_revenue,
                        COALESCE(SUM(profit), 0) AS total_profit
                 FROM sales
                 WHERE sale_date >= $1 AND sale_date < ($2::date + INTERVAL '1 day')
                   AND credit_amount <= credit_amount_paid
                   AND ($3::int IS NULL OR shop_id = $3)
                   AND ($4::text IS NULL OR product_name ILIKE $4)`,
                [input.from, input.to, shopId, input.product_name ? `%${input.product_name}%` : null]
            );
            const r = rows[0];
            return admin ? r : { transactions: r.transactions, total_qty: r.total_qty, total_revenue: r.total_revenue };
        }

        case 'get_top_sellers': {
            const shopId = await resolveShopId(admin, input.shop_name, req.user.shopId);
            const limit = Math.min(Math.max(parseInt(input.limit, 10) || 5, 1), 20);
            const { rows } = await pool.query(
                `SELECT product_name, SUM(qty)::int AS qty_sold, SUM(total) AS revenue
                 FROM sales
                 WHERE sale_date >= $1 AND sale_date < ($2::date + INTERVAL '1 day')
                   AND credit_amount <= credit_amount_paid
                   AND ($3::int IS NULL OR shop_id = $3)
                 GROUP BY product_name
                 ORDER BY qty_sold DESC
                 LIMIT $4`,
                [input.from, input.to, shopId, limit]
            );
            return rows;
        }

        case 'get_commission_summary': {
            // earned_commission (not the raw commission column) — on a credit sale,
            // commission builds up only as the customer actually pays it down. Bucketed
            // by commission_date, not sale_date — see resolveCommissionDate in sales.js.
            if (!admin) {
                const { rows } = await pool.query(
                    `SELECT COALESCE(SUM(earned_commission), 0) AS total_commission, COUNT(*)::int AS sales_count
                     FROM sales
                     WHERE commission_user_id = $1 AND commission_date >= $2 AND commission_date < ($3::date + INTERVAL '1 day')`,
                    [req.user.id, input.from, input.to]
                );
                return { staff: req.user.name, ...rows[0] };
            }
            const { rows } = await pool.query(
                `SELECT u.name, COALESCE(SUM(s.earned_commission), 0) AS total_commission, COUNT(s.id)::int AS sales_count
                 FROM users u
                 LEFT JOIN sales s ON s.commission_user_id = u.id
                     AND s.commission_date >= $1 AND s.commission_date < ($2::date + INTERVAL '1 day')
                 WHERE ($3::text IS NULL OR u.name ILIKE $3)
                 GROUP BY u.name
                 ORDER BY total_commission DESC`,
                [input.from, input.to, input.staff_name ? `%${input.staff_name}%` : null]
            );
            return rows;
        }

        case 'get_stock_history': {
            const shopId = await resolveShopId(admin, input.shop_name, req.user.shopId);
            const { rows } = await pool.query(
                `SELECT p.name, p.quantity AS current,
                        COALESCE(SUM(sm.qty_change) FILTER (WHERE sm.qty_change > 0), 0)::int AS total_added,
                        COALESCE(-SUM(sm.qty_change) FILTER (WHERE sm.type = 'sale'), 0)::int AS total_sold
                 FROM products p
                 LEFT JOIN stock_movements sm ON sm.product_id = p.id
                 WHERE p.name ILIKE $1 AND ($2::int IS NULL OR p.shop_id = $2)
                 GROUP BY p.id, p.name, p.quantity
                 ORDER BY p.name LIMIT 5`,
                [`%${input.product_name}%`, shopId]
            );
            return rows;
        }

        case 'find_sales': {
            const shopId = await resolveShopId(admin, input.shop_name, req.user.shopId);
            const { rows } = await pool.query(
                `SELECT s.receipt_no, s.sale_date, s.product_name, s.customer_name, s.qty, s.unit_price, s.total,
                        s.payment_method, s.credit_amount - s.credit_amount_paid AS credit_unpaid,
                        u.name AS recorded_by, sh.name AS shop_name, s.unit_cost, s.profit
                 FROM sales s
                 LEFT JOIN users u ON u.id = s.user_id
                 LEFT JOIN shops sh ON sh.id = s.shop_id
                 WHERE ($1::int IS NULL OR s.shop_id = $1)
                   AND ($2::date IS NULL OR s.sale_date >= $2)
                   AND ($3::date IS NULL OR s.sale_date < ($3::date + INTERVAL '1 day'))
                   AND ($4::text IS NULL OR s.product_name ILIKE $4)
                   AND ($5::text IS NULL OR s.customer_name ILIKE $5)
                   AND ($6::text IS NULL OR s.receipt_no ILIKE $6)
                   AND ($7::text IS NULL OR s.payment_method ILIKE $7)
                   AND ($8::text IS NULL OR u.name ILIKE $8)
                 ORDER BY s.sale_date DESC
                 LIMIT $9`,
                [shopId, input.from || null, input.to || null, like(input.product_name), like(input.customer_name),
                 like(input.receipt_no), input.payment_method || null, like(input.staff_name), clampLimit(input.limit, 20, 50)]
            );
            return admin ? rows : rows.map(({ unit_cost, profit, ...r }) => r);
        }

        case 'get_sales_breakdown': {
            const groups = {
                day: `to_char(s.sale_date, 'YYYY-MM-DD')`,
                week: `to_char(date_trunc('week', s.sale_date), 'YYYY-MM-DD')`,
                month: `to_char(s.sale_date, 'YYYY-MM')`,
                payment_method: `COALESCE(s.payment_method, 'Unknown')`,
                category: `COALESCE(p.category, 'Uncategorized')`,
                staff: `COALESCE(u.name, 'Unknown')`,
                customer: `COALESCE(NULLIF(s.customer_name, ''), 'Walk-in')`,
                shop: `COALESCE(sh.name, 'Unknown')`,
            };
            const keyExpr = groups[input.group_by];
            if (!keyExpr) throw new Error(`Unsupported group_by: ${input.group_by}`);
            if (input.group_by === 'shop' && !admin) throw new Error('Comparing shops is only available to Admin accounts.');
            const isTime = ['day', 'week', 'month'].includes(input.group_by);
            const shopId = await resolveShopId(admin, input.shop_name, req.user.shopId);
            // keyExpr only ever comes from the fixed map above, never from Claude's input.
            const { rows } = await pool.query(
                `SELECT ${keyExpr} AS ${input.group_by},
                        COUNT(*)::int AS transactions,
                        COALESCE(SUM(s.qty), 0)::int AS total_qty,
                        COALESCE(SUM(s.total), 0) AS total_sales,
                        COALESCE(SUM(s.credit_amount - s.credit_amount_paid), 0) AS unpaid_credit,
                        COALESCE(SUM(s.profit), 0) AS total_profit
                 FROM sales s
                 LEFT JOIN products p ON p.id = s.product_id
                 LEFT JOIN users u ON u.id = s.user_id
                 LEFT JOIN shops sh ON sh.id = s.shop_id
                 WHERE s.sale_date >= $1 AND s.sale_date < ($2::date + INTERVAL '1 day')
                   AND ($3::int IS NULL OR s.shop_id = $3)
                   AND ($4::text IS NULL OR s.product_name ILIKE $4)
                 GROUP BY 1
                 ORDER BY ${isTime ? '1 ASC' : 'total_sales DESC'}
                 LIMIT 60`,
                [input.from, input.to, shopId, like(input.product_name)]
            );
            return admin ? rows : rows.map(({ total_profit, ...r }) => r);
        }

        case 'get_customers': {
            const shopId = await resolveShopId(admin, input.shop_name, req.user.shopId);
            const { rows } = await pool.query(
                `SELECT c.name, c.phone, c.address, c.credit_balance, c.joined_at, sh.name AS shop_name,
                        COUNT(s.id)::int AS purchases, COALESCE(SUM(s.total), 0) AS total_spent,
                        MAX(s.sale_date) AS last_purchase
                 FROM customers c
                 LEFT JOIN shops sh ON sh.id = c.shop_id
                 LEFT JOIN sales s ON s.customer_id = c.id
                 WHERE ($1::int IS NULL OR c.shop_id = $1)
                   AND ($2::text IS NULL OR c.name ILIKE $2 OR c.phone ILIKE $2)
                 GROUP BY c.id, sh.name
                 ORDER BY total_spent DESC
                 LIMIT $3`,
                [shopId, like(input.search), clampLimit(input.limit, 20, 50)]
            );
            return rows;
        }

        case 'get_credit_overview': {
            const shopId = await resolveShopId(admin, input.shop_name, req.user.shopId);
            const owing = await pool.query(
                `SELECT c.name, c.phone, c.credit_balance, sh.name AS shop_name
                 FROM customers c
                 LEFT JOIN shops sh ON sh.id = c.shop_id
                 WHERE c.credit_balance > 0 AND ($1::int IS NULL OR c.shop_id = $1)
                 ORDER BY c.credit_balance DESC
                 LIMIT 40`,
                [shopId]
            );
            const totals = await pool.query(
                `SELECT COUNT(*)::int AS customers_owing, COALESCE(SUM(credit_balance), 0) AS total_owed
                 FROM customers WHERE credit_balance > 0 AND ($1::int IS NULL OR shop_id = $1)`,
                [shopId]
            );
            const repaid = await pool.query(
                `SELECT COUNT(*)::int AS payments, COALESCE(SUM(amount), 0) AS total_repaid
                 FROM credit_payments
                 WHERE ($1::int IS NULL OR shop_id = $1)
                   AND ($2::date IS NULL OR paid_at >= $2)
                   AND ($3::date IS NULL OR paid_at < ($3::date + INTERVAL '1 day'))`,
                [shopId, input.from || null, input.to || null]
            );
            return {
                ...totals.rows[0],
                repayments: { period: input.from || input.to ? { from: input.from || null, to: input.to || null } : 'all time', ...repaid.rows[0] },
                customers: owing.rows,
            };
        }

        case 'get_customer_history': {
            const shopId = await resolveShopId(admin, input.shop_name, req.user.shopId);
            const { rows: matches } = await pool.query(
                `SELECT id, name, phone, credit_balance FROM customers
                 WHERE name ILIKE $1 AND ($2::int IS NULL OR shop_id = $2)
                 ORDER BY (lower(name) = lower($3)) DESC, name LIMIT 5`,
                [like(input.customer_name), shopId, input.customer_name]
            );
            if (!matches.length) return { note: 'No customer found with that name.' };
            const exact = matches.find(m => m.name.toLowerCase() === String(input.customer_name).toLowerCase());
            if (!exact && matches.length > 1) {
                return { note: 'Several customers match — ask which one they mean.', matches: matches.map(({ id, ...m }) => m) };
            }
            const cust = exact || matches[0];
            const purchases = await pool.query(
                `SELECT receipt_no, sale_date, product_name, qty, total, payment_method,
                        credit_amount - credit_amount_paid AS credit_unpaid
                 FROM sales WHERE customer_id = $1 ORDER BY sale_date DESC LIMIT 50`,
                [cust.id]
            );
            const payments = await pool.query(
                `SELECT amount, note, paid_at FROM credit_payments WHERE customer_id = $1 ORDER BY paid_at DESC LIMIT 30`,
                [cust.id]
            );
            const { id, ...customer } = cust;
            return { customer, purchases: purchases.rows, credit_repayments: payments.rows };
        }

        case 'get_stock_movements': {
            const shopId = await resolveShopId(admin, input.shop_name, req.user.shopId);
            const { rows } = await pool.query(
                `SELECT p.name AS product, sm.type, sm.qty_change, sm.balance_after, sm.note,
                        u.name AS by_user, sm.created_at
                 FROM stock_movements sm
                 JOIN products p ON p.id = sm.product_id
                 LEFT JOIN users u ON u.id = sm.user_id
                 WHERE ($1::int IS NULL OR p.shop_id = $1)
                   AND ($2::text IS NULL OR p.name ILIKE $2)
                   AND ($3::date IS NULL OR sm.created_at >= $3)
                   AND ($4::date IS NULL OR sm.created_at < ($4::date + INTERVAL '1 day'))
                   AND ($5::text IS NULL OR sm.type = $5)
                 ORDER BY sm.created_at DESC
                 LIMIT $6`,
                [shopId, like(input.product_name), input.from || null, input.to || null, input.type || null, clampLimit(input.limit, 25, 60)]
            );
            return rows;
        }

        case 'get_deliveries': {
            const shopId = await resolveShopId(admin, input.shop_name, req.user.shopId);
            const { rows } = await pool.query(
                `SELECT d.delivery_no, d.type, d.status, d.delivery_date, fs.name AS from_shop,
                        COALESCE(ts.name, d.to_name) AS destination, d.to_address, d.driver, d.phone, d.total, d.notes,
                        (SELECT json_agg(json_build_object('product', di.product_name, 'qty', di.qty, 'price', di.price))
                         FROM delivery_items di WHERE di.delivery_id = d.id) AS items
                 FROM deliveries d
                 LEFT JOIN shops fs ON fs.id = d.from_shop_id
                 LEFT JOIN shops ts ON ts.id = d.to_shop_id
                 WHERE ($1::int IS NULL OR d.from_shop_id = $1)
                   AND ($2::text IS NULL OR d.status ILIKE $2)
                   AND ($3::date IS NULL OR d.delivery_date >= $3)
                   AND ($4::date IS NULL OR d.delivery_date < ($4::date + INTERVAL '1 day'))
                   AND ($5::text IS NULL OR d.to_name ILIKE $5 OR ts.name ILIKE $5)
                 ORDER BY d.delivery_date DESC
                 LIMIT $6`,
                [shopId, input.status || null, input.from || null, input.to || null, like(input.recipient), clampLimit(input.limit, 15, 40)]
            );
            return rows;
        }

        case 'get_inventory_summary': {
            const shopId = await resolveShopId(admin, input.shop_name, req.user.shopId);
            const col = input.group_by === 'brand' ? 'brand' : 'category';
            // col only ever comes from the two fixed values above.
            const { rows } = await pool.query(
                `SELECT COALESCE(NULLIF(${col}, ''), 'Unspecified') AS ${col},
                        COUNT(*)::int AS products,
                        COALESCE(SUM(quantity), 0)::int AS units_in_stock,
                        COUNT(*) FILTER (WHERE quantity <= 0)::int AS out_of_stock,
                        COALESCE(SUM(selling_price * quantity), 0) AS selling_value,
                        COALESCE(SUM(cost_price * quantity), 0) AS cost_value
                 FROM products
                 WHERE ($1::int IS NULL OR shop_id = $1)
                 GROUP BY 1
                 ORDER BY selling_value DESC`,
                [shopId]
            );
            return admin ? rows : rows.map(({ cost_value, ...r }) => r);
        }

        // ----- Admin-only tools below. runTool is only ever reached for these names when
        // the caller is Admin, since TOOLS_ADMIN is never handed to Claude otherwise — but
        // each query is still written as if shopId could be set, out of caution. -----

        case 'get_shop_overview': {
            const { rows } = await pool.query(
                `SELECT s.name, s.status,
                        COUNT(p.id)::int AS product_count,
                        COALESCE(SUM(p.quantity), 0)::int AS total_quantity,
                        COALESCE(SUM(p.cost_price * p.quantity), 0) AS total_cost_value,
                        COALESCE(SUM(p.selling_price * p.quantity), 0) AS total_selling_value
                 FROM shops s
                 LEFT JOIN products p ON p.shop_id = s.id
                 WHERE ($1::text IS NULL OR s.name ILIKE $1)
                 GROUP BY s.id, s.name, s.status
                 ORDER BY s.name`,
                [input.shop_name ? `%${input.shop_name}%` : null]
            );
            return rows;
        }

        case 'get_staff_list': {
            const { rows } = await pool.query(
                `SELECT u.name, u.role, u.status, s.name AS shop_name
                 FROM users u
                 LEFT JOIN shops s ON s.id = u.shop_id
                 WHERE ($1::text IS NULL OR s.name ILIKE $1)
                 ORDER BY u.name`,
                [input.shop_name ? `%${input.shop_name}%` : null]
            );
            return rows;
        }

        case 'get_recent_activity': {
            const limit = Math.min(Math.max(parseInt(input.limit, 10) || 10, 1), 30);
            const { rows } = await pool.query(
                `SELECT name, role, action, entity_type, description, created_at
                 FROM activity_log
                 ORDER BY created_at DESC
                 LIMIT $1`,
                [limit]
            );
            return rows;
        }

        case 'get_commission_settlement_status': {
            const { rows } = await pool.query(
                `SELECT u.name, cs.total_commission,
                        (cs.staff_confirmed_at IS NOT NULL) AS staff_confirmed_received,
                        (cs.admin_confirmed_at IS NOT NULL) AS admin_confirmed_paid
                 FROM commission_settlements cs
                 JOIN users u ON u.id = cs.user_id
                 WHERE cs.year = $1 AND cs.month = $2
                 ORDER BY u.name`,
                [input.year, input.month]
            );
            return rows.length ? rows : { note: 'No settlement records for that month yet — nobody has confirmed received or paid.' };
        }

        case 'get_login_history': {
            const { rows } = await pool.query(
                `SELECT name, role, login_at FROM login_history
                 WHERE ($1::text IS NULL OR name ILIKE $1)
                 ORDER BY login_at DESC
                 LIMIT $2`,
                [like(input.staff_name), clampLimit(input.limit, 20, 50)]
            );
            return rows;
        }

        default:
            throw new Error(`Unknown tool: ${name}`);
    }
}

// POST /api/ai/ask  { question, history? }
router.post('/ask', verifyToken, requireRole(...ASK_ROLES), askLimiter, async (req, res) => {
    const { question, history } = req.body;
    if (!question || !question.trim()) return res.status(400).json({ error: 'A question is required' });
    if (!client) return res.status(503).json({ error: 'AI assistant is not configured on this server yet' });

    const admin = req.user.role === 'Admin';
    const tools = admin ? [...TOOLS_BASE, ...TOOLS_ADMIN] : TOOLS_BASE;

    const today = new Date().toISOString().slice(0, 10);
    const systemPrompt = `You are the in-app assistant for Reliavolt Supply ("We Go For Value"), an electrical-supply shop's inventory system in Sierra Leone. You're answering ${req.user.name} (role: ${req.user.role}${req.user.shopId ? `, shop_id ${req.user.shopId}` : ''}) inside a chat widget they opened from within the app.
Today's date is ${today}. Use it to resolve relative dates like "last month", "this week", or "yesterday" into exact YYYY-MM-DD ranges before calling a tool.

You can help with three kinds of requests:
1. Real data lookups — stock and inventory value, restock/adjustment history, individual sales and receipts, sales trends and breakdowns (by day/week/month, payment method, category, staff, customer${admin ? ', shop' : ''}), customers and their purchase history, who owes credit and repayments, deliveries and transfers, commission${admin ? ', plus shop comparisons, staff, logins, system activity, and commission settlement status' : ''}. Combine tools freely to answer deeper questions (e.g. "is X selling fast enough to restock?" = sales breakdown + stock + last restock). Always use a tool to get real numbers before answering. Never guess or make up figures. If a tool returns no matching rows, say so plainly instead of inventing an answer.${admin ? " Most tools accept an optional shop_name, so when asked about one specific shop (e.g. 'August sales for the Bo shop'), pass that shop's name rather than fetching company-wide totals and saying you can't filter — you can." : ''}
2. Reports — when asked for a "report", "summary", "overview", "recap", "breakdown", or something like "how's business doing", switch out of one-line mode: call several relevant tools (sales summary, top sellers, low stock, outstanding credit${admin ? ', and for a company-wide ask, shop overview or commission settlement status' : ', and your own commission'}) for the period in question, then write a short structured report with a few labeled sections (e.g. "📊 Sales", "🏆 Top Sellers", "⚠️ Low Stock", "💰 Commission") — a couple of lines each, real numbers throughout, not a wall of text. If no period is named, default to the current month.
3. How-to questions about using the system — answer directly from what you know about it, no tool needed:
   - Dashboard: daily stats, commission summary, recent sales, low stock, this chat.
   - Inventory: add/edit products (Admin), import from Excel/CSV, each product has a "History" button showing every stock addition and sale with running totals.
   - Sales: record a sale (pick product + qty, optionally backdate it with "Sale Date" if it happened earlier), edit an already-recorded sale's date/customer/payment method, paginated Recent Sales list with a date filter.
   - Reports: Daily/Weekly/Monthly sales, Profit (Admin), Low Stock, Stock (added/sold/remaining per product, printable to PDF via the browser's print dialog), Chart, By Shop.
   - Commission: a flat amount per unit sold, set per product, optionally assigned to one designated staff member who always earns it regardless of who processes the sale; once a month ends, both the staff member and an Admin confirm it separately (received / paid).
   - Settings, Users and Shops (Admin only), System Logs (Admin only, full activity audit trail).

ACCESS POLICY — this matters, follow it strictly:
${admin
    ? '- This caller is an Admin/owner: they can see everything — every shop, every staff member\'s data, cost price and profit, company-wide activity, and commission settlement status. Answer any in-scope business question fully using your tools.'
    : `- This caller is a ${req.user.role}, scoped to their own shop only. They can see their own shop's stock and sales, and only their own commission — never cost price, never profit, never another shop's or another staff member's figures, never the company-wide staff list or system activity log.
- If asked for something outside that scope (another shop's numbers, company-wide totals, other staff's commission, the activity log, cost/profit), don't guess or invent a plausible-sounding number — briefly explain that's limited to Admin accounts and suggest asking an Admin.`}

NOTE ON REVENUE — get_sales_summary and get_top_sellers count only fully-paid sales (credit sales are left out until paid off), matching the app's reports. get_sales_breakdown and find_sales include every sale and show unpaid credit separately. If figures from the two differ, that's why — say so rather than presenting them as conflicting.

PRINTING — if asked to "print", "save as PDF", "download", or "export" something: the app automatically opens a print dialog on whatever you write back, so don't just confirm — put the actual full content (the report, the figures, whatever was asked for) in your answer text itself. If they're asking to print something already covered earlier in this conversation, repeat it in full here rather than saying "see above".

Currency is Sierra Leonean Leone; format amounts like "Le 45,000".
Keep ordinary answers short and conversational — one or two sentences, like a quick reply from a coworker in a chat. Reports (and anything being printed) are the deliberate exception: structured and a bit longer, but still scannable, not an essay.`;

    const messages = [...sanitizeHistory(history), { role: 'user', content: question.trim() }];

    try {
        let response = await client.messages.create({
            model: MODEL, max_tokens: 2048, system: systemPrompt, tools, messages,
        });

        let iterations = 0;
        while (response.stop_reason === 'tool_use' && iterations < 8) {
            iterations++;
            messages.push({ role: 'assistant', content: response.content });

            const toolResults = [];
            for (const block of response.content) {
                if (block.type !== 'tool_use') continue;
                let content;
                try {
                    content = JSON.stringify(await runTool(block.name, block.input, req));
                } catch (err) {
                    content = JSON.stringify({ error: err.message });
                }
                toolResults.push({ type: 'tool_result', tool_use_id: block.id, content });
            }
            messages.push({ role: 'user', content: toolResults });

            response = await client.messages.create({
                model: MODEL, max_tokens: 2048, system: systemPrompt, tools, messages,
            });
        }

        const answer = response.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
        res.json({ answer: answer || "I couldn't find an answer to that." });
    } catch (err) {
        console.error('AI query failed:', err);
        res.status(500).json({ error: 'Something went wrong answering that question' });
    }
});

module.exports = router;
