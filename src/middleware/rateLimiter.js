const rateLimit = require('express-rate-limit');

const tmdbApiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    message: 'Servidor sobrecarregado. Por favor, tente novamente dentro de um minuto.',
  },
});

module.exports = {
  tmdbApiLimiter,
};

