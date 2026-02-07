const axios = require('axios');
const env = require('../config/env');

const startKeepAlive = () => {
  setInterval(async () => {
    try {
      await axios.get(`${env.BACKEND_URL}/api/health`);
    } catch (error) {
    }
  }, 10 * 60 * 1000); // 10 minutos
};

module.exports = { startKeepAlive };