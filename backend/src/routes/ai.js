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
const MODEL = process.env.AI_QUERY_MODEL || 'claude-haiku-4-5';

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
            },
            required: ['product_name'],
        },
    },
    {
        name: 'list_low_stock',
        description: "List products that are low in stock (10 units or fewer) or completely out of stock. Use this for questions like 'what's running low' or 'what do we need to restock'.",
        input_schema: { type: 'object', properties: {} },
    },
    {
        name: 'get_sales_summary',
        description: "Get total units sold, revenue, and transaction count over a date range, optionally filtered to one product. Use this for questions like 'how many X did we sell last month' or 'what was our revenue this week'. Dates are YYYY-MM-DD.",
        input_schema: {
            type: 'object',
            properties: {
                from: { type: 'string', description: 'Start date, YYYY-MM-DD, inclusive' },
                to: { type: 'string', description: 'End date, YYYY-MM-DD, inclusive' },
                product_name: { type: 'string', description: 'Optional: restrict to products matching this name (partial match)' },
            },
            required: ['from', 'to'],
        },
    },
    {
        name: 'get_top_sellers',
        description: "Get the best-selling products by quantity over a date range. Use this for questions like 'what's our top seller this month'. Dates are YYYY-MM-DD.",
        input_schema: {
            type: 'object',
            properties: {
                from: { type: 'string', description: 'Start date, YYYY-MM-DD, inclusive' },
                to: { type: 'string', description: 'End date, YYYY-MM-DD, inclusive' },
                limit: { type: 'integer', description: 'How many top products to return (default 5)' },
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
            },
            required: ['product_name'],
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
];

const ADMIN_ONLY_TOOL_NAMES = new Set(TOOLS_ADMIN.map(t => t.name));

async function runTool(name, input, req) {
    const admin = req.user.role === 'Admin';
    const shopId = admin ? null : req.user.shopId;

    // Belt-and-braces: even though a non-Admin's request never includes TOOLS_ADMIN in the
    // first place, refuse to execute one of those queries here too, in case that ever
    // changes upstream without this file being updated to match.
    if (!admin && ADMIN_ONLY_TOOL_NAMES.has(name)) {
        throw new Error('This information is only available to Admin accounts.');
    }

    switch (name) {
        case 'get_product_stock': {
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
            const { rows } = await pool.query(
                `SELECT COUNT(*)::int AS transactions,
                        COALESCE(SUM(qty), 0)::int AS total_qty,
                        COALESCE(SUM(total), 0) AS total_revenue,
                        COALESCE(SUM(profit), 0) AS total_profit
                 FROM sales
                 WHERE sale_date >= $1 AND sale_date < ($2::date + INTERVAL '1 day')
                   AND ($3::int IS NULL OR shop_id = $3)
                   AND ($4::text IS NULL OR product_name ILIKE $4)`,
                [input.from, input.to, shopId, input.product_name ? `%${input.product_name}%` : null]
            );
            const r = rows[0];
            return admin ? r : { transactions: r.transactions, total_qty: r.total_qty, total_revenue: r.total_revenue };
        }

        case 'get_top_sellers': {
            const limit = Math.min(Math.max(parseInt(input.limit, 10) || 5, 1), 20);
            const { rows } = await pool.query(
                `SELECT product_name, SUM(qty)::int AS qty_sold, SUM(total) AS revenue
                 FROM sales
                 WHERE sale_date >= $1 AND sale_date < ($2::date + INTERVAL '1 day')
                   AND ($3::int IS NULL OR shop_id = $3)
                 GROUP BY product_name
                 ORDER BY qty_sold DESC
                 LIMIT $4`,
                [input.from, input.to, shopId, limit]
            );
            return rows;
        }

        case 'get_commission_summary': {
            if (!admin) {
                const { rows } = await pool.query(
                    `SELECT COALESCE(SUM(commission), 0) AS total_commission, COUNT(*)::int AS sales_count
                     FROM sales
                     WHERE commission_user_id = $1 AND sale_date >= $2 AND sale_date < ($3::date + INTERVAL '1 day')`,
                    [req.user.id, input.from, input.to]
                );
                return { staff: req.user.name, ...rows[0] };
            }
            const { rows } = await pool.query(
                `SELECT u.name, COALESCE(SUM(s.commission), 0) AS total_commission, COUNT(s.id)::int AS sales_count
                 FROM users u
                 LEFT JOIN sales s ON s.commission_user_id = u.id
                     AND s.sale_date >= $1 AND s.sale_date < ($2::date + INTERVAL '1 day')
                 WHERE ($3::text IS NULL OR u.name ILIKE $3)
                 GROUP BY u.name
                 ORDER BY total_commission DESC`,
                [input.from, input.to, input.staff_name ? `%${input.staff_name}%` : null]
            );
            return rows;
        }

        case 'get_stock_history': {
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

You can help with two kinds of questions:
1. Real data lookups (stock, sales, commission${admin ? ', shop comparisons, staff, system activity, and commission settlement status' : ''}) — always use a tool to get real numbers before answering. Never guess or make up figures. If a tool returns no matching rows, say so plainly instead of inventing an answer.
2. How-to questions about using the system — answer directly from what you know about it, no tool needed:
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

Currency is Sierra Leonean Leone; format amounts like "Le 45,000".
Keep answers short and conversational — one or two sentences, like a quick reply from a coworker in a chat, not a report. Only elaborate if the question genuinely needs more than that.`;

    const messages = [...sanitizeHistory(history), { role: 'user', content: question.trim() }];

    try {
        let response = await client.messages.create({
            model: MODEL, max_tokens: 1024, system: systemPrompt, tools, messages,
        });

        let iterations = 0;
        while (response.stop_reason === 'tool_use' && iterations < 5) {
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
                model: MODEL, max_tokens: 1024, system: systemPrompt, tools, messages,
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
