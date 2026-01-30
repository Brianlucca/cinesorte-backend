// Minimal env for tests
process.env.FRONTEND_URL = 'http://localhost:3000';
process.env.FIREBASE_WEB_API_KEY = 'fake-api-key';
process.env.TELEGRAM_BOT_TOKEN = 'fake';
process.env.TELEGRAM_CHAT_ID = 'fake';
process.env.PORT = '3001';
process.env.NODE_ENV = 'development';

const request = require('supertest');
const axios = require('axios');
const app = require('../../src/server');
const { auth, db } = require('../../src/config/firebase');

jest.mock('axios');

describe('Integration: auth cookie security', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('POST /api/users/login sets authToken cookie (HttpOnly, Secure, SameSite=None) and does not return tokens in body', async () => {
    axios.post.mockImplementation(async (url, data) => {
      if (url.includes('signInWithPassword')) {
        return { data: { localId: 'uid456', idToken: 'idtoken', email: 'u@example.com' } };
      }
      return { data: {} };
    });

    auth.getUser = jest.fn(async () => ({ uid: 'uid456', emailVerified: true }));
    auth.createSessionCookie = jest.fn(async () => 'session-cookie-value');

    const userDoc = { exists: true, data: () => ({ username: 'u', photoURL: null, name: 'U' }) };
    db.collection = jest.fn(() => ({ doc: () => ({ get: async () => userDoc }) }));

    const res = await request(app)
      .post('/api/users/login')
      .send({ email: 'u@example.com', password: 'secret' })
      .expect(200);

    // ensure set-cookie header exists
    const setCookie = res.headers['set-cookie'];
    expect(setCookie).toBeDefined();
    const cookieString = setCookie.join(';');
    expect(cookieString.includes('authToken=')).toBe(true);
    expect(cookieString.match(/HttpOnly/i)).toBeTruthy();
    expect(cookieString.match(/SameSite=None/i)).toBeTruthy();
    // 'Secure' may be present depending on environment/config
    expect(cookieString.match(/Secure/i)).toBeTruthy();

    // body should not leak tokens
    expect(res.body).not.toHaveProperty('idToken');
    expect(res.body).not.toHaveProperty('authToken');
  });
});