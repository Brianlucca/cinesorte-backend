const axios = require('axios');

const startKeepAlive = () => {
  const url = process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 3001}`;
  
  setInterval(async () => {
    try {
      await axios.get(url);
      console.log('Keep-alive ping sent');
    } catch (error) {
      console.error('Keep-alive ping failed');
    }
  }, 14 * 60 * 1000); 
};

module.exports = { startKeepAlive };