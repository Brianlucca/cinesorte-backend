const { searchUsers, getUserProfile } = require('../src/controllers/userController');

function makeRes() {
  let statusCode = 200;
  let body = null;
  return {
    status(code) { statusCode = code; return this; },
    json(obj) { body = obj; this._body = obj; this._status = statusCode; },
    _get() { return { statusCode, body }; }
  };
}

describe('userController public responses', () => {
  test('searchUsers does not include uid in results', async () => {
    // mock db behavior
    const mockDoc = { id: 'uid123', data: () => ({ name: 'A', username: 'a', photoURL: 'p' }) };
    const mockSnapshot = { docs: [mockDoc] };

    // mock db collection chain
    jest.mocked = true; // noop to avoid linter complaint
    const db = require('../src/config/firebase').db;
    const collectionMock = jest.fn(() => ({
      where: () => ({ where: () => ({ limit: () => ({ get: async () => mockSnapshot }) }) })
    }));
    db.collection = collectionMock;

    const req = { query: { query: 'abc' } };
    const res = makeRes();

    await searchUsers(req, res, (err) => { if (err) throw err; });

    expect(res._body).toBeDefined();
    expect(Array.isArray(res._body)).toBe(true);
    expect(res._body[0].uid).toBeUndefined();
    expect(res._body[0].username).toBe('a');
  });

  test('getUserProfile does not include uid or email', async () => {
    const mockDoc = { id: 'uid456', data: () => ({ name: 'B', username: 'b', photoURL: 'p', email: 'b@example.com' }) };
    const snapshot = { empty: false, docs: [mockDoc] };

    const db = require('../src/config/firebase').db;
    db.collection = jest.fn(() => ({ where: () => ({ limit: () => ({ get: async () => snapshot }) }) }));

    const req = { params: { username: 'b' } };
    const res = makeRes();

    await getUserProfile(req, res, (err) => { if (err) throw err; });

    expect(res._body).toBeDefined();
    expect(res._body.uid).toBeUndefined();
    expect(res._body.email).toBeUndefined();
    expect(res._body.username).toBe('b');
  });
});