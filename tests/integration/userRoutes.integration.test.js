// Set minimal env for tests
process.env.FRONTEND_URL = 'http://localhost:3000';
process.env.FIREBASE_WEB_API_KEY = 'fake-api-key';
process.env.TELEGRAM_BOT_TOKEN = 'fake';
process.env.TELEGRAM_CHAT_ID = 'fake';
process.env.PORT = '3001';
process.env.NODE_ENV = 'development';

const request = require('supertest');
const app = require('../../src/server');

const db = require('../../src/config/firebase').db;

describe('Integration: public user routes', () => {
  beforeEach(() => {
    const mockDoc = { id: 'uid456', data: () => ({ name: 'B', username: 'b', photoURL: 'p', email: 'b@example.com' }) };
    const snapshot = { empty: false, docs: [mockDoc], docs0: mockDoc };

    db.collection = jest.fn(() => ({
      where: () => ({ limit: () => ({ get: async () => snapshot }) })
    }));

    // Mock auth session verification to make protected profile endpoint accessible in tests
    const auth = require('../../src/config/firebase').auth;
    auth.verifySessionCookie = jest.fn(async (cookie) => ({ uid: 'uid456', email_verified: true, email: 'b@example.com' }));
  });

  test('route /api/users/profile/:username is protected (401 without auth)', async () => {
    await request(app).get('/api/users/profile/b').expect(401);
  });
});