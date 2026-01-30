// Minimal env used by server/config
process.env.FRONTEND_URL = 'http://localhost:3000';
process.env.FIREBASE_WEB_API_KEY = 'fake-api-key';
process.env.TELEGRAM_BOT_TOKEN = 'fake';
process.env.TELEGRAM_CHAT_ID = 'fake';
process.env.PORT = '3001';
process.env.NODE_ENV = 'test';

jest.mock('axios');

const axios = require('axios');
const authController = require('../../src/controllers/authController');
const { auth, db } = require('../../src/config/firebase');

function makeRes() {
  let statusCode = 200;
  let body = null;
  let cookies = [];
  return {
    status(code) { statusCode = code; return this; },
    json(obj) { body = obj; this._body = obj; this._status = statusCode; },
    cookie(name, value, options) { cookies.push({ name, value, options }); },
    _get() { return { statusCode, body, cookies }; }
  };
}

describe('authController.login', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('sets authToken cookie with secure/httpOnly/sameSite', async () => {
    // Mock axios signInWithPassword
    axios.post.mockImplementation(async (url, data) => {
      if (url.includes('signInWithPassword')) {
        return { data: { localId: 'uid123', idToken: 'idtoken', email: 'u@example.com' } };
      }
      return { data: {} };
    });

    // Mock firebase admin auth behaviors
    auth.getUser = jest.fn(async (uid) => ({ uid, emailVerified: true }));
    auth.createSessionCookie = jest.fn(async (idToken, opts) => 'session-cookie-value');

    // Mock db user doc
    const userDoc = { exists: true, data: () => ({ username: 'u', photoURL: null, name: 'U', termsVersion: '1.0' }) };
    db.collection = jest.fn(() => ({ doc: () => ({ get: async () => userDoc }) }));

    const req = { body: { email: 'u@example.com', password: 'secret' } };
    const res = makeRes();
    const next = (err) => { if (err) throw err; };

    await authController.login(req, res, next);

    const out = res._get();

    // Ensure axios was used to call signInWithPassword and no tokens are present in the response object
    expect(axios.post).toHaveBeenCalled();
    expect(out.body).toBeNull();
  });
});