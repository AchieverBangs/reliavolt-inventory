const test    = require('node:test');
const assert  = require('node:assert');
const request = require('supertest');
const app     = require('../src/app');
const auth    = require('../src/routes/auth');

test('buildResetLink uses the current frontend origin when FRONTEND_URL is absent', () => {
    const url = auth.buildResetLink('http://localhost:5500', 'abc123');
    assert.strictEqual(url, 'http://localhost:5500/reset-password.html?token=abc123');
});

test('detectFrontendBase ignores cross-origin Referer/Origin headers and uses FRONTEND_URL', () => {
    const originalEnv = process.env.FRONTEND_URL;
    process.env.FRONTEND_URL = 'https://achieverbangs.github.io/reliavolt-inventory/Reliavolt-Inventory-Frontend';

    // Simulates the real bug: a cross-origin browser request only ever sends the
    // bare origin in Referer/Origin (path stripped), never the app's subfolder.
    const fakeReq = {
        headers: {
            referer: 'https://achieverbangs.github.io/', // path already stripped by the browser
            origin:  'https://achieverbangs.github.io',
        },
    };

    const base = auth.detectFrontendBase(fakeReq);
    const link = auth.buildResetLink(base, 'abc123');

    assert.strictEqual(base, 'https://achieverbangs.github.io/reliavolt-inventory/Reliavolt-Inventory-Frontend');
    assert.strictEqual(link, 'https://achieverbangs.github.io/reliavolt-inventory/Reliavolt-Inventory-Frontend/reset-password.html?token=abc123');

    process.env.FRONTEND_URL = originalEnv;
});

test('GET /api/health returns ok', async () => {
    const res = await request(app).get('/api/health');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.status, 'ok');
});

test('unknown route returns 404', async () => {
    const res = await request(app).get('/api/does-not-exist');
    assert.strictEqual(res.status, 404);
});

test('protected route rejects request with no token', async () => {
    const res = await request(app).get('/api/products');
    assert.strictEqual(res.status, 401);
});

test('login rejects missing credentials', async () => {
    const res = await request(app).post('/api/auth/login').send({});
    assert.strictEqual(res.status, 400);
});
