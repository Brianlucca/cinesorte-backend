// Mock firebase-admin to avoid needing service account in CI/tests
jest.mock('firebase-admin', () => {
  const apps = [];
  const mockAuth = () => ({
    getUser: async (uid) => ({ uid, emailVerified: true }),
    createSessionCookie: async (idToken, opts) => 'session-cookie-mock',
    createCustomToken: async (uid) => `custom-token-${uid}`,
    verifySessionCookie: async (cookie) => ({ uid: 'mock-uid', email_verified: true }),
  });

  const mockFirestore = () => ({
    collection: (name) => ({
      where: () => ({ limit: () => ({ get: async () => ({ empty: true, docs: [] }) }) }),
      doc: () => ({ get: async () => ({ exists: false, data: () => ({}) }) }),
    }),
  });

  return {
    apps,
    initializeApp: jest.fn(),
    credential: { cert: jest.fn((obj) => obj) },
    auth: mockAuth,
    firestore: mockFirestore,
  };
});
