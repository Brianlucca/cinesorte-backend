const axios = require('axios');
const env = require('../config/env');

const startKeepAlive = () => {
  setInterval(async () => {
    try {
      await axios.get(`${env.FRONTEND_URL}/api/health`);
    } catch (error) {
    }
  }, 14 * 60 * 1000);
};

module.exports = { startKeepAlive };