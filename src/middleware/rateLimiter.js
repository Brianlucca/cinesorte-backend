const rateLimit = require('express-rate-limit');

const tmdbApiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: {
    message: 'Servidor sobrecarregado. Por favor, tente novamente em alguns instantes.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

module.exports = {
  tmdbApiLimiter,
};