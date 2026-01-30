const authController = require('../src/controllers/authController');

const req = {
  body: { name: 'Teste', nickname: `test_user_invoke_${Date.now()}`, email: `invoke+test+${Date.now()}@example.com`, password: 'Abc!123' },
  headers: { 'user-agent': 'node-test' }
};

const res = {
  status(code) { this._status = code; return this; },
  json(obj) { console.log('res.json', this._status, obj); }
};

const next = (err) => {
  console.error('next called with error:', err && err.message, err && err.statusCode);
};

(async () => {
  try {
    await authController.register(req, res, next);
  } catch (e) {
    console.error('unhandled exception:', e);
  }
})();