const express   = require('express');
const rateLimit = require('express-rate-limit');
const Anthropic = require('@anthropic-ai/sdk');
const pool      = require('../db/pool');
const { verifyToken, requireRole } = require('../middleware/auth');

const router = express.Router();
const ASK_ROLES = ['Admin', 'Manager', 'Cashier', 'Stock Manager'];

// Each question costs real money (an Anthropic API call) — cap per-user, not per-IP,
// since a whole shop can share one network connection.
const askLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => String(req.user?.id || req.ip),
    message: { error: 'Too many questions in a short time. Please wait a few minutes and try again.' },
});

const client = process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;
const MODEL = process.env.AI_QUERY_MODEL || 'claude-haiku-4-5';

// ===== TOOLS — each is a narrow, parameterized query. Claude picks which to call and
// with what arguments, but shop-scoping and cost/profit visibility are enforced here in
// code from the caller's real role/shop, never from anything Claude sends — so a question
// can't be phrased in a way that leaks another shop's data or a non-Admin's cost/profit. =====

const TOOLS = [
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
];

async function runTool(name, input, req) {
    const admin = req.user.role === 'Admin';
    const shopId = admin ? null : req.user.shopId;

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

        default:
            throw new Error(`Unknown tool: ${name}`);
    }
}

// POST /api/ai/ask  { question }
router.post('/ask', verifyToken, requireRole(...ASK_ROLES), askLimiter, async (req, res) => {
    const { question } = req.body;
    if (!question || !question.trim()) return res.status(400).json({ error: 'A question is required' });
    if (!client) return res.status(503).json({ error: 'AI assistant is not configured on this server yet' });

    const today = new Date().toISOString().slice(0, 10);
    const systemPrompt = `You are a helpful assistant inside Reliavolt Supply's inventory system, answering ${req.user.name} (role: ${req.user.role}${req.user.shopId ? `, shop_id ${req.user.shopId}` : ''}).
Today's date is ${today}. Use it to resolve relative dates like "last month", "this week", or "yesterday" into exact YYYY-MM-DD ranges before calling a tool.
Always use a tool to look up real numbers before answering — never guess or make up figures. If a tool returns no matching rows, say so plainly instead of inventing an answer.
Currency is Sierra Leonean Leone; format amounts like "Le 45,000".
Keep answers short and conversational — one or two sentences, like a quick reply from a coworker, not a report.`;

    const messages = [{ role: 'user', content: question.trim() }];

    try {
        let response = await client.messages.create({
            model: MODEL, max_tokens: 1024, system: systemPrompt, tools: TOOLS, messages,
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
                model: MODEL, max_tokens: 1024, system: systemPrompt, tools: TOOLS, messages,
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
