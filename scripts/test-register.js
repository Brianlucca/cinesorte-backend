const axios = require('axios');

(async () => {
  try {
    const res = await axios.post('http://localhost:3001/api/users/register', {
      name: 'Teste',
      nickname: 'test_user_debug_123',
      email: 'debug+test@example.com',
      password: 'Abc!123'
    }, { timeout: 10000 });
    console.log('status', res.status, res.data);
  } catch (err) {
    if (err.response) {
      console.error('response error', err.response.status, err.response.data);
    } else {
      console.error('error', err.message);
    }
    process.exit(1);
  }
})();