const validate = require('../src/middleware/validate');
const { registerSchema } = require('../src/schemas/schemas');

const mw = validate(registerSchema);

const req = { body: { name: 'Teste', nickname: 'abc', email: 'a@b.c', password: 'Abc!123' } };
const res = {};
const next = (err) => { if (err) console.error('next error:', err.message, err.statusCode); else console.log('next called without error'); };

try {
  mw(req, res, next);
} catch (e) {
  console.error('mw threw:', e);
}

console.log('req after mw:', req);