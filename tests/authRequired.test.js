const request = require('supertest');

describe('Auth required endpoints', () => {
  let app;

  beforeAll(() => {
    jest.resetModules();

    // minimal mock DB - not needed because auth should block before DB calls
    const mockDb = {
      collection: () => ({ get: async () => ({ empty: true, docs: [] }) }),
    };

    jest.doMock('../src/config/firebase', () => ({ db: mockDb, auth: {} }));

    app = require('../src/server');
  });

  const origin = 'http://localhost:5173';

  test('GET /api/social/feed/collections should require authentication', async () => {
    const res = await request(app).get('/api/social/feed/collections').set('Origin', origin);
    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/Acesso negado|Sessão inválida/);
  });

  test('GET /api/social/lists/someuser/abc should require authentication', async () => {
    const res = await request(app).get('/api/social/lists/someuser/abc').set('Origin', origin);
    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/Acesso negado|Sessão inválida/);
  });

  test('GET /api/social/followers/someuser should require authentication', async () => {
    const res = await request(app).get('/api/social/followers/someuser').set('Origin', origin);
    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/Acesso negado|Sessão inválida/);
  });

  test('GET /api/social/following/someuser should require authentication', async () => {
    const res = await request(app).get('/api/social/following/someuser').set('Origin', origin);
    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/Acesso negado|Sessão inválida/);
  });

  test('GET /api/social/comments/any should require authentication', async () => {
    const res = await request(app).get('/api/social/comments/any').set('Origin', origin);
    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/Acesso negado|Sessão inválida/);
  });
});
