const test    = require('node:test');
const assert  = require('node:assert');
const request = require('supertest');
const app     = require('../src/app');

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
