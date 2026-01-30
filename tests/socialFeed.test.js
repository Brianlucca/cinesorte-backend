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

  test('GET /api/social/feed/global should not expose userId for unauthenticated requests', async () => {
    const res = await request(app).get('/api/social/feed/global').set('Origin', 'http://localhost:5173');
    if (res.status !== 200) console.error('Feed error body:', res.body);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
    const item = res.body[0];
    expect(item).not.toHaveProperty('userId');
    expect(item).toHaveProperty('username', 'testuser');
    expect(item).toHaveProperty('userPhoto', 'https://example.com/photo.jpg');
    expect(item).toHaveProperty('mediaId', 123);
  });
});
