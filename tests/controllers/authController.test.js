// Set minimal env for tests
process.env.FRONTEND_URL = 'http://localhost:3000';
process.env.FIREBASE_WEB_API_KEY = 'fake-api-key';
process.env.TELEGRAM_BOT_TOKEN = 'fake';
process.env.TELEGRAM_CHAT_ID = 'fake';
process.env.PORT = '3001';
process.env.NODE_ENV = 'development';

const authController = require('../../src/controllers/authController');
const db = require('../../src/config/firebase').db;

function makeRes() {
  let statusCode = 200;
  let body = null;
  return {
    status(code) { statusCode = code; return this; },
    json(obj) { body = obj; this._body = obj; this._status = statusCode; },
    _get() { return { statusCode, body }; }
  };
}

describe('authController.getPublicProfile', () => {
  test('does not include uid or email', async () => {
    const mockDoc = { id: 'uid789', data: () => ({ name: 'C', username: 'c', photoURL: 'p', email: 'c@example.com' }) };
    const snapshot = { empty: false, docs: [mockDoc] };

    db.collection = jest.fn(() => ({ where: () => ({ limit: () => ({ get: async () => snapshot }) }) }));

    const req = { params: { username: 'c' } };
    const res = makeRes();
    const next = (err) => { if (err) throw err; };

    await authController.getPublicProfile(req, res, next);

    expect(res._body).toBeDefined();
    expect(res._body.username).toBe('c');
    expect(res._body.uid).toBeUndefined();
    expect(res._body.email).toBeUndefined();
  });
});