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
    created_at    TIMESTAMP     NOT NULL DEFAULT NOW()
);

-- Customers
CREATE TABLE IF NOT EXISTS customers (
    id         SERIAL PRIMARY KEY,
    name       VARCHAR(255) NOT NULL,
    phone      VARCHAR(50),
    address    TEXT,
    joined_at  DATE         NOT NULL DEFAULT CURRENT_DATE
);

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

-- Password reset tokens
CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id         SERIAL PRIMARY KEY,
    user_id    INTEGER   NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token      VARCHAR(128) NOT NULL UNIQUE,
    expires_at TIMESTAMP NOT NULL,
    used       BOOLEAN   NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ============================================================
-- Seed Data (safe to re-run — uses ON CONFLICT DO NOTHING)
-- ============================================================

INSERT INTO shops (id, name, address, phone, manager, status, created_at) VALUES
(1, 'Main Branch',         '25 Siaka Stevens Street, Freetown', '+232 76 111222', 'Admin Owner',   'Active',  '2025-01-01'),
(2, 'Congo Cross Branch',  '8 Congo Cross Road, Freetown',      '+232 78 333444', 'Fatima Jalloh', 'Active',  '2025-03-01'),
(3, 'Wellington Branch',   '15 Wellington Street, Freetown',    '+232 99 555666', 'TBD',           'Planned', '2025-04-10')
ON CONFLICT (id) DO NOTHING;

-- Reset shop sequence
SELECT setval('shops_id_seq', (SELECT MAX(id) FROM shops));

INSERT INTO users (id, name, username, password_hash, role, shop_id, status, created_at) VALUES
(1, 'Admin Owner',     'admin',   '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'Admin',           NULL, 'Active',   '2025-01-01'),
(2, 'Amadu Koroma',    'amadu',   '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'Cashier',         1,    'Active',   '2025-02-15'),
(3, 'Fatima Jalloh',   'fatima',  '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'Manager',         2,    'Active',   '2025-03-01'),
(4, 'Ibrahim Sesay',   'ibrahim', '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'Stock Manager',   1,    'Inactive', '2025-03-20'),
(5, 'Mariama Bangura', 'mariama', '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'Cashier',         2,    'Active',   '2025-04-05'),
(6, 'Sorie Kamara',    'sorie',   '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'Delivery Person', 1,    'Active',   '2025-04-20'),
(7, 'Foday Turay',     'foday',   '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'Delivery Person', 2,    'Active',   '2025-05-01')
ON CONFLICT (id) DO NOTHING;

-- NOTE: The password_hash above is bcrypt of 'password' (Laravel default fixture hash).
-- After setup, run: node scripts/seed-passwords.js   to set real passwords.

SELECT setval('users_id_seq', (SELECT MAX(id) FROM users));

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
(18, 'Tape Insulation Roll',        'Accessories',   '3M',             5000,    8000,    9,   '🔧')
ON CONFLICT (id) DO NOTHING;

SELECT setval('products_id_seq', (SELECT MAX(id) FROM products));

INSERT INTO customers (id, name, phone, address, joined_at) VALUES
(1, 'Mohamed Kamara',   '+232 76 123456', '12 Wilkinson Road, Freetown', '2025-01-15'),
(2, 'Aminata Sesay',    '+232 78 987654', '45 Congo Cross, Freetown',    '2025-02-03'),
(3, 'Foday Koroma',     '+232 99 112233', 'Lumley, Freetown',            '2025-02-20'),
(4, 'Fatmata Conteh',   '+232 77 445566', 'Murray Town, Freetown',       '2025-03-08'),
(5, 'Alpha Bangura',    '+232 76 778899', 'Calaba Town, Freetown',       '2025-03-15'),
(6, 'Hawa Turay',       '+232 78 334455', 'Kissy, Freetown',             '2025-04-01'),
(7, 'Ibrahim Mansaray', '+232 99 667788', 'Wellington, Freetown',        '2025-04-12'),
(8, 'Mariama Bah',      '+232 76 223344', 'Aberdeen, Freetown',          '2025-04-28')
ON CONFLICT (id) DO NOTHING;

SELECT setval('customers_id_seq', (SELECT MAX(id) FROM customers));
