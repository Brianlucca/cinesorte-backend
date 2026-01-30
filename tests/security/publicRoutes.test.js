process.env.FRONTEND_URL = 'http://localhost:3000';
process.env.FIREBASE_WEB_API_KEY = 'fake-api-key';
process.env.TELEGRAM_BOT_TOKEN = 'fake';
process.env.TELEGRAM_CHAT_ID = 'fake';
process.env.PORT = '3001';
process.env.NODE_ENV = 'development';

const request = require('supertest');
const app = require('../../src/server');
const db = require('../../src/config/firebase').db;

function containsForbidden(obj, forbiddenKeys) {
  if (obj === null || obj === undefined) return false;
  if (Array.isArray(obj)) return obj.some((v) => containsForbidden(v, forbiddenKeys));
  if (typeof obj === 'object') {
    return Object.keys(obj).some((k) => forbiddenKeys.includes(k) || containsForbidden(obj[k], forbiddenKeys));
  }
  return false;
}

describe('Security: public routes should not expose sensitive fields', () => {
  beforeEach(() => {
    // Mock profile route DB
    const mockDoc = { id: 'uid456', data: () => ({ name: 'B', username: 'b', photoURL: 'p', email: 'b@example.com' }) };
    const snapshot = { empty: false, docs: [mockDoc] };
    db.collection = jest.fn(() => ({ where: () => ({ limit: () => ({ get: async () => snapshot }) }) }));

    // Mock TMDB API for public endpoints that call it
    const tmdbApi = require('../../src/api/tmdb');
    tmdbApi.get = jest.fn(async (path) => {
      if (path === '/genre/movie/list' || path === '/genre/tv/list') {
        return { data: { genres: [{ id: 1, name: 'Action' }] } };
      }
      return { data: {} };
    });
  });

  const publicEndpoints = [
    { method: 'get', path: '/' },
    { method: 'get', path: '/api/tmdb/genres' }
  ];

  const forbidden = ['uid', 'email', 'password', 'authToken', 'idToken'];

  publicEndpoints.forEach((ep) => {
    test(`${ep.method.toUpperCase()} ${ep.path} does not contain forbidden keys`, async () => {
      const res = await request(app)[ep.method](ep.path).expect(200);
      const body = res.body;
      const found = containsForbidden(body, forbidden);
      expect(found).toBe(false);
    });
  });
});