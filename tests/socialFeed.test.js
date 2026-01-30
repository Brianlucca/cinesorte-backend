const request = require('supertest');

describe('Social Feed - Public', () => {
  let app;

  beforeAll(() => {
    // reset modules so our firebase mock applies before server loads
    jest.resetModules();

    const mockReviews = [
      {
        id: 'rev1',
        data: () => ({
          mediaId: 123,
          mediaType: 'movie',
          mediaTitle: 'Test Movie',
          userId: 'leaky-uid',
          username: 'testuser',
          userPhoto: 'https://example.com/photo.jpg',
          rating: 4,
          createdAt: new Date(),
        }),
      },
    ];

    const mockDb = {
      collection: (name) => {
        if (name === 'reviews') {
          return {
            orderBy: () => ({ limit: () => ({ get: async () => ({ docs: mockReviews }) }) }),
            doc: () => ({ collection: () => ({ doc: () => ({ get: async () => ({ exists: false }) }) }) }),
          };
        }
        // minimal stubs for other collections
        return {
          orderBy: () => ({ limit: () => ({ get: async () => ({ empty: true, docs: [] }) }) }),
          doc: () => ({ get: async () => ({ exists: false, data: () => ({}) }) }),
          where: () => ({ limit: () => ({ get: async () => ({ empty: true, docs: [] }) }) }),
        };
      },
    };

    jest.doMock('../src/config/firebase', () => ({ db: mockDb, auth: {} }));

    app = require('../src/server');
  });

  test('GET /api/social/feed/global should require authentication', async () => {
    const res = await request(app).get('/api/social/feed/global').set('Origin', 'http://localhost:5173');
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('message');
    expect(res.body.message).toMatch(/Acesso negado|Sessão inválida/);
  });
});
