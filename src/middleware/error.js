const env = require('../config/env');
const { sendAlert } = require('../services/telegramService');

module.exports = (err, req, res, next) => {
  err.statusCode = err.statusCode || 500;
  err.status = err.status || 'error';

  if (env.NODE_ENV === 'production') {
    if (err.statusCode === 500) {
      sendAlert(`ERRO CRITICO (500)\n\nMensagem: ${err.message}\nRota: ${req.originalUrl}\nMetodo: ${req.method}`);
    }

    if (err.isOperational) {
      res.status(err.statusCode).json({
        status: err.status,
        message: err.message
      });
    } else {
      res.status(500).json({
        status: 'error',
        message: 'Algo deu errado.'
      });
    }
  } else {
    res.status(err.statusCode).json({
      status: err.status,
      message: err.message,
      error: err,
      stack: err.stack
    });
  }
};