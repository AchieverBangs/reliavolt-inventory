-- ============================================================
-- Reliavolt Supply — PostgreSQL Schema
-- Run once: psql -U postgres -d reliavolt_db -f schema.sql
-- ============================================================

-- Shops (must exist before users FK)
CREATE TABLE IF NOT EXISTS shops (
    id          SERIAL PRIMARY KEY,
    name        VARCHAR(255) NOT NULL,
    address     TEXT,
    phone       VARCHAR(50),
    manager     VARCHAR(255),
    status      VARCHAR(20)  NOT NULL DEFAULT 'Active',
    created_at  TIMESTAMP    NOT NULL DEFAULT NOW()
);

-- Users
CREATE TABLE IF NOT EXISTS users (
    id            SERIAL PRIMARY KEY,
    name          VARCHAR(255) NOT NULL,
    username      VARCHAR(100) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role          VARCHAR(50)  NOT NULL DEFAULT 'Cashier',
    shop_id       INTEGER REFERENCES shops(id) ON DELETE SET NULL,
    status        VARCHAR(20)  NOT NULL DEFAULT 'Active',
    created_at    TIMESTAMP    NOT NULL DEFAULT NOW()
);

-- Login audit trail (Admin can see every user's login times)
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login TIMESTAMP;

-- A simple global on/off for whether this user can create/edit/delete anything (see
-- requireWrite in middleware/auth.js) — they can still view every page while off, just
-- not change anything. Checked fresh on every request rather than baked into the login
-- token, so flipping it takes effect immediately, not just next login. Admin is always
-- exempt (this is Admin's own tool for managing everyone else, not a way to accidentally
-- lock themselves out).
ALTER TABLE users ADD COLUMN IF NOT EXISTS can_write BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS login_history (
    id       SERIAL PRIMARY KEY,
    user_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
    username VARCHAR(100),
    name     VARCHAR(255),
    role     VARCHAR(50),
    login_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_login_history_login_at ON login_history(login_at DESC);

-- Products (inventory)
CREATE TABLE IF NOT EXISTS products (
    id            SERIAL PRIMARY KEY,
    name          VARCHAR(255) NOT NULL,
    category      VARCHAR(100),
    brand         VARCHAR(100),
    cost_price    NUMERIC(14,2) NOT NULL DEFAULT 0,
    selling_price NUMERIC(14,2) NOT NULL DEFAULT 0,
    quantity      INTEGER       NOT NULL DEFAULT 0,
    icon          VARCHAR(10)   DEFAULT '📦',
    shop_id       INTEGER       REFERENCES shops(id) ON DELETE SET NULL,
    created_at    TIMESTAMP     NOT NULL DEFAULT NOW()
);

-- Per-shop stock (safe to run again) — existing rows backfill to Main Branch (id=1)
ALTER TABLE products ADD COLUMN IF NOT EXISTS shop_id INTEGER REFERENCES shops(id) ON DELETE SET NULL;
UPDATE products SET shop_id = 1 WHERE shop_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_products_shop_id ON products(shop_id);

-- Commission — flat amount paid per unit sold, set on the product itself
ALTER TABLE products ADD COLUMN IF NOT EXISTS commission NUMERIC(14,2) NOT NULL DEFAULT 0;

-- Commission owner — when set, this staff member always earns the commission on
-- this product, no matter who actually processes the sale. When unset (NULL),
-- commission falls back to whoever rang up the sale (the previous behavior).
ALTER TABLE products ADD COLUMN IF NOT EXISTS commission_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;

-- Customers
CREATE TABLE IF NOT EXISTS customers (
    id         SERIAL PRIMARY KEY,
    name       VARCHAR(255) NOT NULL,
    phone      VARCHAR(50),
    address    TEXT,
    shop_id    INTEGER      REFERENCES shops(id) ON DELETE SET NULL,
    joined_at  DATE         NOT NULL DEFAULT CURRENT_DATE
);

-- Per-shop customers (safe to run again) — existing rows backfill to Main Branch (id=1)
ALTER TABLE customers ADD COLUMN IF NOT EXISTS shop_id INTEGER REFERENCES shops(id) ON DELETE SET NULL;
UPDATE customers SET shop_id = 1 WHERE shop_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_customers_shop_id ON customers(shop_id);

-- Running balance a customer currently owes from buying on credit. Goes up when a credit
-- sale is recorded, down as they make payments (see credit_payments below).
ALTER TABLE customers ADD COLUMN IF NOT EXISTS credit_balance NUMERIC(14,2) NOT NULL DEFAULT 0;

-- Sales
CREATE TABLE IF NOT EXISTS sales (
    id             SERIAL PRIMARY KEY,
    receipt_no     VARCHAR(50)   UNIQUE NOT NULL,
    product_id     INTEGER       REFERENCES products(id) ON DELETE SET NULL,
    product_name   VARCHAR(255),
    customer_id    INTEGER       REFERENCES customers(id) ON DELETE SET NULL,
    customer_name  VARCHAR(255),
    qty            INTEGER       NOT NULL,
    unit_price     NUMERIC(14,2) NOT NULL,
    unit_cost      NUMERIC(14,2) NOT NULL,
    total          NUMERIC(14,2) NOT NULL,
    profit         NUMERIC(14,2) NOT NULL,
    payment_method VARCHAR(50)   DEFAULT 'Cash',
    shop_id        INTEGER       REFERENCES shops(id) ON DELETE SET NULL,
    sale_date      TIMESTAMP     NOT NULL DEFAULT NOW()
);

-- Attribute each sale to whoever rang it up (audit trail) and record the
-- commission earned at sale time (captured then, so later changes to a
-- product's commission rate/owner don't rewrite history). commission_user_id
-- is who actually EARNS the commission — the product's designated owner if
-- it has one, otherwise the same as user_id.
ALTER TABLE sales ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS commission NUMERIC(14,2) NOT NULL DEFAULT 0;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS commission_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_sales_user_id ON sales(user_id);
CREATE INDEX IF NOT EXISTS idx_sales_commission_user_id ON sales(commission_user_id);

-- How much of this sale's total was put on the customer's tab rather than paid at the
-- time of sale (0 for a normal fully-paid sale). Requires a real, named customer — credit
-- can't be extended to an anonymous walk-in.
ALTER TABLE sales ADD COLUMN IF NOT EXISTS credit_amount NUMERIC(14,2) NOT NULL DEFAULT 0;

-- How much of this specific sale's credit_amount has been paid back so far (credit
-- payments are allocated across a customer's open credit sales oldest-first — see
-- POST /api/customers/:id/credit-payments). 0 for a sale with no credit portion.
ALTER TABLE sales ADD COLUMN IF NOT EXISTS credit_amount_paid NUMERIC(14,2) NOT NULL DEFAULT 0;

-- Commission actually earned so far on this sale: the full flat commission for a normal
-- fully-paid sale (credit_amount = 0, so this reduces to exactly `commission`), but only
-- the paid fraction of it for a credit sale — a salesperson earns commission as the money
-- actually comes in, not upfront on a balance the customer hasn't paid yet. Recomputes
-- automatically whenever commission, total, credit_amount, or credit_amount_paid change
-- (e.g. the product-edit backfill below, or a new credit payment), so nothing else needs
-- to keep it in sync by hand — every commission total elsewhere should SUM this column,
-- not the raw `commission` column.
ALTER TABLE sales ADD COLUMN IF NOT EXISTS earned_commission NUMERIC(14,2)
    GENERATED ALWAYS AS (commission * LEAST(1, (total - credit_amount + credit_amount_paid) / NULLIF(total, 0))) STORED;

-- Each payment a customer makes toward their running credit_balance (see customers
-- above). Independent of any one sale — a payment just pays down the running total,
-- the same way a shopkeeper's paper ledger would.
CREATE TABLE IF NOT EXISTS credit_payments (
    id          SERIAL PRIMARY KEY,
    customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    amount      NUMERIC(14,2) NOT NULL,
    note        TEXT,
    shop_id     INTEGER REFERENCES shops(id) ON DELETE SET NULL,
    user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
    paid_at     TIMESTAMP NOT NULL DEFAULT NOW(),
    created_at  TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_credit_payments_customer ON credit_payments(customer_id, paid_at DESC);

-- Exactly which sale(s) each payment paid down, and by how much — recorded at payment
-- time (see POST /api/customers/:id/credit-payments) so a payment can later be reversed
-- precisely: give each affected sale's credit_amount_paid back, rather than guessing.
CREATE TABLE IF NOT EXISTS credit_payment_allocations (
    id          SERIAL PRIMARY KEY,
    payment_id  INTEGER NOT NULL REFERENCES credit_payments(id) ON DELETE CASCADE,
    sale_id     INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
    amount      NUMERIC(14,2) NOT NULL,
    created_at  TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_credit_payment_allocations_payment ON credit_payment_allocations(payment_id);

-- One-time backfill (safe to rerun — only touches customers with zero allocation rows so
-- far) for payments recorded before this table existed: replays each customer's credit
-- sales and payments in the same chronological, oldest-sale-first order the live code
-- already applies them in, so it reconstructs exactly how each past payment was really
-- split across sales, letting a payment made before this feature shipped still be
-- reversed precisely.
DO $$
DECLARE
    cust RECORD;
    pay RECORD;
    sale RECORD;
    remaining NUMERIC;
    apply NUMERIC;
BEGIN
    CREATE TEMP TABLE IF NOT EXISTS _credit_backfill_cap (sale_id INTEGER PRIMARY KEY, cap NUMERIC);

    FOR cust IN
        SELECT DISTINCT cp.customer_id
        FROM credit_payments cp
        WHERE NOT EXISTS (
            SELECT 1 FROM credit_payment_allocations cpa
            JOIN credit_payments cp2 ON cp2.id = cpa.payment_id
            WHERE cp2.customer_id = cp.customer_id
        )
    LOOP
        DELETE FROM _credit_backfill_cap;
        INSERT INTO _credit_backfill_cap (sale_id, cap)
            SELECT id, credit_amount FROM sales WHERE customer_id = cust.customer_id AND credit_amount > 0;

        FOR pay IN
            SELECT id, amount FROM credit_payments
            WHERE customer_id = cust.customer_id
            ORDER BY paid_at ASC, id ASC
        LOOP
            remaining := pay.amount;
            FOR sale IN
                SELECT s.id AS sale_id, c.cap AS cap
                FROM _credit_backfill_cap c
                JOIN sales s ON s.id = c.sale_id
                WHERE c.cap > 0
                ORDER BY s.sale_date ASC, s.id ASC
            LOOP
                IF remaining <= 0 THEN EXIT; END IF;
                apply := LEAST(remaining, sale.cap);
                IF apply > 0 THEN
                    INSERT INTO credit_payment_allocations (payment_id, sale_id, amount) VALUES (pay.id, sale.sale_id, apply);
                    UPDATE _credit_backfill_cap SET cap = cap - apply WHERE sale_id = sale.sale_id;
                    remaining := remaining - apply;
                END IF;
            END LOOP;
        END LOOP;
    END LOOP;

    DROP TABLE IF EXISTS _credit_backfill_cap;
END $$;

-- Full audit trail of every quantity change for a product — initial stock on creation,
-- restocks/adjustments made via product edit, and deductions from each sale. A single
-- "quantity" column can only ever show what's left right now; this answers "how much did
-- I add in total, and where did it go" by keeping every change with a running balance.
CREATE TABLE IF NOT EXISTS stock_movements (
    id            SERIAL PRIMARY KEY,
    product_id    INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    type          VARCHAR(20) NOT NULL, -- 'initial' | 'restock' | 'adjustment' | 'sale'
    qty_change    INTEGER NOT NULL,     -- positive = added, negative = removed
    balance_after INTEGER NOT NULL,
    note          TEXT,
    user_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,
    sale_id       INTEGER REFERENCES sales(id) ON DELETE SET NULL,
    created_at    TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_stock_movements_product ON stock_movements(product_id, created_at DESC);

-- Correction for the very first version of the backfill below (shipped 2026-09-24): it only
-- knew each product's CURRENT quantity, so for any product that already had sales before
-- stock history existed, it logged that leftover amount as if it were the whole original
-- stock — undercounting "Total Added" and silently dropping those sales from "Total Sold"
-- entirely. Safe to rerun: once a historical sale has its own movement row (sale_id set),
-- it's excluded, so this naturally stops finding anything to fix.
DO $$
DECLARE
    prod RECORD;
    total_historical INTEGER;
    true_original INTEGER;
    anchor TIMESTAMP;
    running_balance INTEGER;
    sale_rec RECORD;
BEGIN
    FOR prod IN
        SELECT sm.id AS old_movement_id, sm.product_id, sm.qty_change AS old_baseline, sm.created_at AS old_created_at
        FROM stock_movements sm
        WHERE sm.note = 'Backfilled — recorded when stock history was added'
          AND EXISTS (
              SELECT 1 FROM sales s
              WHERE s.product_id = sm.product_id
                AND NOT EXISTS (SELECT 1 FROM stock_movements sm2 WHERE sm2.sale_id = s.id)
          )
    LOOP
        SELECT COALESCE(SUM(s.qty), 0), LEAST(MIN(s.sale_date), prod.old_created_at) - INTERVAL '1 second'
        INTO total_historical, anchor
        FROM sales s
        WHERE s.product_id = prod.product_id
          AND NOT EXISTS (SELECT 1 FROM stock_movements sm2 WHERE sm2.sale_id = s.id);

        true_original := prod.old_baseline + total_historical;

        -- The old baseline's value was never actually wrong — it came straight from the
        -- product's real quantity at the time, so every later real movement's balance
        -- (computed from that same live quantity, independent of this ledger) is still
        -- correct as-is. Only its label was wrong: it's a mid-history balance, not the
        -- true starting point. Replace it outright instead of shifting anything downstream.
        DELETE FROM stock_movements WHERE id = prod.old_movement_id;

        INSERT INTO stock_movements (product_id, type, qty_change, balance_after, note, created_at)
        VALUES (prod.product_id, 'initial', true_original, true_original,
                'Backfilled — recorded when stock history was added', anchor);

        running_balance := true_original;
        FOR sale_rec IN
            SELECT s.id, s.qty, s.sale_date, s.receipt_no, s.user_id
            FROM sales s
            WHERE s.product_id = prod.product_id
              AND NOT EXISTS (SELECT 1 FROM stock_movements sm2 WHERE sm2.sale_id = s.id)
            ORDER BY s.sale_date ASC, s.id ASC
        LOOP
            running_balance := running_balance - sale_rec.qty;
            INSERT INTO stock_movements (product_id, type, qty_change, balance_after, note, user_id, sale_id, created_at)
            VALUES (prod.product_id, 'sale', -sale_rec.qty, running_balance,
                    'Sold via receipt ' || sale_rec.receipt_no, sale_rec.user_id, sale_rec.id, sale_rec.sale_date);
        END LOOP;
    END LOOP;
END $$;

-- One-time backfill (safe to rerun — only touches products with zero movement rows so
-- far): a product's true original stock is its current quantity plus every sale it has
-- ever had (since any sale predating this feature was never logged as a movement), so
-- this reconstructs the full history — the initial amount, then one 'sale' movement per
-- historical sale with a correct running balance — instead of just the leftover quantity.
DO $$
DECLARE
    prod RECORD;
    total_historical INTEGER;
    true_original INTEGER;
    running_balance INTEGER;
    sale_rec RECORD;
BEGIN
    FOR prod IN
        SELECT p.id AS product_id, p.quantity AS current_qty, p.created_at AS product_created_at
        FROM products p
        WHERE NOT EXISTS (SELECT 1 FROM stock_movements sm WHERE sm.product_id = p.id)
    LOOP
        SELECT COALESCE(SUM(s.qty), 0) INTO total_historical FROM sales s WHERE s.product_id = prod.product_id;
        true_original := prod.current_qty + total_historical;
        IF true_original = 0 THEN CONTINUE; END IF;

        INSERT INTO stock_movements (product_id, type, qty_change, balance_after, note, created_at)
        VALUES (prod.product_id, 'initial', true_original, true_original,
                'Backfilled — recorded when stock history was added', prod.product_created_at);

        running_balance := true_original;
        FOR sale_rec IN
            SELECT s.id, s.qty, s.sale_date, s.receipt_no, s.user_id
            FROM sales s WHERE s.product_id = prod.product_id
            ORDER BY s.sale_date ASC, s.id ASC
        LOOP
            running_balance := running_balance - sale_rec.qty;
            INSERT INTO stock_movements (product_id, type, qty_change, balance_after, note, user_id, sale_id, created_at)
            VALUES (prod.product_id, 'sale', -sale_rec.qty, running_balance,
                    'Sold via receipt ' || sale_rec.receipt_no, sale_rec.user_id, sale_rec.id, sale_rec.sale_date);
        END LOOP;
    END LOOP;
END $$;

-- One row per (staff member, month) once that month's commission has been settled.
-- staff_confirmed_at = the earner says they received it; admin_confirmed_at = an Admin
-- says it was paid out. Independent of each other — either can happen first.
-- total_commission is a snapshot taken at confirm time, since a later product edit can
-- retroactively change commission on past sales.
CREATE TABLE IF NOT EXISTS commission_settlements (
    id                  SERIAL PRIMARY KEY,
    user_id             INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    year                INTEGER NOT NULL,
    month               INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
    total_commission    NUMERIC(14,2) NOT NULL DEFAULT 0,
    staff_confirmed_at  TIMESTAMP,
    admin_confirmed_at  TIMESTAMP,
    admin_confirmed_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at          TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, year, month)
);
CREATE INDEX IF NOT EXISTS idx_commission_settlements_user ON commission_settlements(user_id);

-- System-wide activity log (every create/update/delete, for Admin review)
CREATE TABLE IF NOT EXISTS activity_log (
    id          SERIAL PRIMARY KEY,
    user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
    username    VARCHAR(100),
    name        VARCHAR(255),
    role        VARCHAR(50),
    action      VARCHAR(20)  NOT NULL,
    entity_type VARCHAR(50)  NOT NULL,
    entity_id   INTEGER,
    description TEXT,
    created_at  TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_activity_log_created_at ON activity_log(created_at DESC);

-- Deliveries
CREATE TABLE IF NOT EXISTS deliveries (
    id            SERIAL PRIMARY KEY,
    delivery_no   VARCHAR(50)   UNIQUE NOT NULL,
    type          VARCHAR(50)   NOT NULL DEFAULT 'Customer Delivery',
    from_shop_id  INTEGER       REFERENCES shops(id) ON DELETE SET NULL,
    to_name       VARCHAR(255),
    to_address    TEXT,
    to_shop_id    INTEGER       REFERENCES shops(id) ON DELETE SET NULL,
    total         NUMERIC(14,2) DEFAULT 0,
    status        VARCHAR(50)   NOT NULL DEFAULT 'Pending',
    driver        VARCHAR(255),
    phone         VARCHAR(50),
    notes         TEXT,
    delivery_date TIMESTAMP     NOT NULL DEFAULT NOW()
);

-- Delivery line items
CREATE TABLE IF NOT EXISTS delivery_items (
    id           SERIAL PRIMARY KEY,
    delivery_id  INTEGER       NOT NULL REFERENCES deliveries(id) ON DELETE CASCADE,
    product_name VARCHAR(255),
    qty          INTEGER,
    price        NUMERIC(14,2)
);

-- App settings (always exactly one row)
CREATE TABLE IF NOT EXISTS settings (
    id             INTEGER PRIMARY KEY DEFAULT 1,
    company_name   VARCHAR(255) DEFAULT 'Reliavolt Supply',
    currency       VARCHAR(10)  DEFAULT 'Le',
    receipt_footer TEXT         DEFAULT '"We Go For Value" | Thank you for your business!',
    theme          VARCHAR(20)  DEFAULT 'light',
    CONSTRAINT single_settings_row CHECK (id = 1)
);

-- Seed default settings row
INSERT INTO settings (id) VALUES (1) ON CONFLICT DO NOTHING;

-- Add email to users (safe to run again)
ALTER TABLE users ADD COLUMN IF NOT EXISTS email VARCHAR(255);

-- Tracks whether demo seed data has already been inserted once, so deleting a
-- demo row doesn't cause it to reappear on the next deploy/restart.
ALTER TABLE settings ADD COLUMN IF NOT EXISTS seeded BOOLEAN NOT NULL DEFAULT FALSE;

-- Existing installations already have this data — mark them seeded now so the
-- guarded block below doesn't try to re-insert rows that already exist.
UPDATE settings SET seeded = TRUE WHERE id = 1 AND EXISTS (SELECT 1 FROM users);

-- Password reset tokens
CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id         SERIAL PRIMARY KEY,
    user_id    INTEGER   NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token      VARCHAR(128) NOT NULL UNIQUE,
    expires_at TIMESTAMP NOT NULL,
    used       BOOLEAN   NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- "What's new" announcements — a short changelog shown once per staff member, delivered
-- through the Ask Reliavolt chat widget rather than a separate admin page for now.
CREATE TABLE IF NOT EXISTS app_updates (
    id         SERIAL PRIMARY KEY,
    title      VARCHAR(255) NOT NULL,
    body       TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Newest update each user has already seen, so an announcement only ever shows once.
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen_update_id INTEGER NOT NULL DEFAULT 0;

-- First announcement — guarded so it's only ever inserted once, independent of the demo
-- seed flag above (this should still insert on a real production install).
INSERT INTO app_updates (title, body)
SELECT 'Meet Ask Reliavolt — your new AI assistant',
       'Look for the 🤖 bubble in the bottom-right corner of every page. Ask it things like "how many LED bulbs do we have left" or "what was our revenue last month", or how-to questions like "how do I backdate a sale". Admins can also ask about other shops, staff, and commission settlement status.'
WHERE NOT EXISTS (SELECT 1 FROM app_updates);

-- ============================================================
-- Seed Data — runs ONCE only, guarded by settings.seeded.
-- Without this guard, deleting a demo row would make it reappear
-- on the next deploy/restart (ON CONFLICT DO NOTHING only skips
-- a row that still exists — a deleted id is "free" again).
-- ============================================================

DO $$
BEGIN
    IF NOT (SELECT seeded FROM settings WHERE id = 1) THEN

        INSERT INTO shops (id, name, address, phone, manager, status, created_at) VALUES
        (1, 'Main Branch',         '25 Siaka Stevens Street, Freetown', '+232 76 111222', 'Admin Owner',   'Active',  '2025-01-01'),
        (2, 'Congo Cross Branch',  '8 Congo Cross Road, Freetown',      '+232 78 333444', 'Fatima Jalloh', 'Active',  '2025-03-01'),
        (3, 'Wellington Branch',   '15 Wellington Street, Freetown',    '+232 99 555666', 'TBD',           'Planned', '2025-04-10');

        PERFORM setval('shops_id_seq', (SELECT MAX(id) FROM shops));

        INSERT INTO users (id, name, username, password_hash, role, shop_id, status, created_at) VALUES
        (1, 'Admin Owner',     'admin',   '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'Admin',           NULL, 'Active',   '2025-01-01'),
        (2, 'Amadu Koroma',    'amadu',   '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'Cashier',         1,    'Active',   '2025-02-15'),
        (3, 'Fatima Jalloh',   'fatima',  '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'Manager',         2,    'Active',   '2025-03-01'),
        (4, 'Ibrahim Sesay',   'ibrahim', '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'Stock Manager',   1,    'Inactive', '2025-03-20'),
        (5, 'Mariama Bangura', 'mariama', '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'Cashier',         2,    'Active',   '2025-04-05'),
        (6, 'Sorie Kamara',    'sorie',   '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'Delivery Person', 1,    'Active',   '2025-04-20'),
        (7, 'Foday Turay',     'foday',   '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'Delivery Person', 2,    'Active',   '2025-05-01');

        -- NOTE: password_hash above is bcrypt of 'password' (fixture default).
        -- Run node scripts/seed-passwords.js afterward to set real passwords.

        PERFORM setval('users_id_seq', (SELECT MAX(id) FROM users));

        INSERT INTO products (id, name, category, brand, cost_price, selling_price, quantity, icon) VALUES
        (1,  'LED Bulb 9W',                 'Lighting',      'Philips',        15000,   22000,   150, '💡'),
        (2,  'LED Bulb 18W',                'Lighting',      'Philips',        25000,   38000,   80,  '💡'),
        (3,  'Extension Cord 3m',           'Accessories',   'Generic',        25000,   40000,   8,   '🔌'),
        (4,  'Extension Cord 5m',           'Accessories',   'Generic',        38000,   58000,   5,   '🔌'),
        (5,  'Circuit Breaker 32A',         'Protection',    'Schneider',      85000,   130000,  0,   '⚡'),
        (6,  'Circuit Breaker 16A',         'Protection',    'Schneider',      65000,   100000,  22,  '⚡'),
        (7,  'Power Strip 5-outlet',        'Accessories',   'Goldstar',       42000,   65000,   35,  '🔌'),
        (8,  'Wall Socket (Double)',        'Fittings',      'MK Electric',    18000,   28000,   60,  '🔌'),
        (9,  'Light Switch (Single)',       'Fittings',      'MK Electric',    12000,   20000,   3,   '💡'),
        (10, 'PVC Conduit Pipe 2m',         'Conduits',      'Clipsal',        8000,    14000,   200, '📏'),
        (11, 'Electrical Cable 2.5mm (per m)', 'Cables',     'Nexans',         5500,    8000,    500, '🔧'),
        (12, 'Electrical Cable 4mm (per m)',   'Cables',     'Nexans',         9000,    13000,   300, '🔧'),
        (13, 'Inverter 1000W',              'Solar & Power', 'Luminous',       850000,  1200000, 6,   '🔋'),
        (14, 'Solar Panel 100W',            'Solar & Power', 'Canadian Solar', 650000,  950000,  0,   '☀️'),
        (15, 'Battery 12V 100Ah',           'Solar & Power', 'Ritar',          750000,  1050000, 4,   '🔋'),
        (16, 'MCB 20A (DIN Rail)',          'Protection',    'Legrand',        45000,   70000,   18,  '⚡'),
        (17, 'Ceiling Fan 52"',             'Appliances',    'Havells',        480000,  680000,  7,   '🌀'),
        (18, 'Tape Insulation Roll',        'Accessories',   '3M',             5000,    8000,    9,   '🔧');

        PERFORM setval('products_id_seq', (SELECT MAX(id) FROM products));

        INSERT INTO customers (id, name, phone, address, shop_id, joined_at) VALUES
        (1, 'Mohamed Kamara',   '+232 76 123456', '12 Wilkinson Road, Freetown', 1, '2025-01-15'),
        (2, 'Aminata Sesay',    '+232 78 987654', '45 Congo Cross, Freetown',    1, '2025-02-03'),
        (3, 'Foday Koroma',     '+232 99 112233', 'Lumley, Freetown',            1, '2025-02-20'),
        (4, 'Fatmata Conteh',   '+232 77 445566', 'Murray Town, Freetown',       1, '2025-03-08'),
        (5, 'Alpha Bangura',    '+232 76 778899', 'Calaba Town, Freetown',       2, '2025-03-15'),
        (6, 'Hawa Turay',       '+232 78 334455', 'Kissy, Freetown',             2, '2025-04-01'),
        (7, 'Ibrahim Mansaray', '+232 99 667788', 'Wellington, Freetown',        2, '2025-04-12'),
        (8, 'Mariama Bah',      '+232 76 223344', 'Aberdeen, Freetown',          2, '2025-04-28');

        PERFORM setval('customers_id_seq', (SELECT MAX(id) FROM customers));

        UPDATE settings SET seeded = TRUE WHERE id = 1;
    END IF;
END $$;
