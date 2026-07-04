const express  = require('express');
const cors     = require('cors');

const authRouter       = require('./routes/auth');
const productsRouter   = require('./routes/products');
const salesRouter      = require('./routes/sales');
const customersRouter  = require('./routes/customers');
const usersRouter      = require('./routes/users');
const shopsRouter      = require('./routes/shops');
const deliveriesRouter = require('./routes/deliveries');
const settingsRouter   = require('./routes/settings');

const app = express();

// CORS — allow frontend origin (file:// and localhost dev servers)
const allowedOrigins = [
    process.env.CLIENT_ORIGIN || 'http://localhost:5500',
    'http://127.0.0.1:5500',
    'http://localhost:3000',
    'null', // file:// requests have Origin: null
];

app.use(cors({
    origin: (origin, cb) => {
        if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
        cb(new Error(`CORS blocked: ${origin}`));
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(express.json());

// Health check
app.get('/api/health', (req, res) => res.json({ status: 'ok', app: 'Reliavolt Supply API' }));

// Routes
app.use('/api/auth',       authRouter);
app.use('/api/products',   productsRouter);
app.use('/api/sales',      salesRouter);
app.use('/api/customers',  customersRouter);
app.use('/api/users',      usersRouter);
app.use('/api/shops',      shopsRouter);
app.use('/api/deliveries', deliveriesRouter);
app.use('/api/settings',   settingsRouter);

// 404 handler
app.use((req, res) => res.status(404).json({ error: `Route ${req.method} ${req.path} not found` }));

// Global error handler
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: err.message || 'Internal server error' });
});

module.exports = app;
