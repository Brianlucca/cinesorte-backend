const rateLimit = require('express-rate-limit');
const env = require('../config/env');
const { sendAlert } = require('../services/telegramService');

const userTracker = new Map();

const userSpamDetector = (req, res, next) => {
  if (req.user && req.user.username) {
    const username = req.user.username;
    const now = Date.now();
    const userData = userTracker.get(username) || { count: 0, start: now };

    if (now - userData.start > 60000) {
      userData.count = 1;
      userData.start = now;
    } else {
      userData.count++;
    }

    userTracker.set(username, userData);

    if (userData.count > 60) {
      sendAlert(`SUSPEITA DE SPAM\n\nUser: @${username}\nReq/min: ${userData.count}\nIP: ${req.ip}`);
      userData.count = 0;
    }
  }
  next();
};

const tmdbApiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 100,
  message: { message: 'Muitas requisicoes.' }
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  handler: (req, res) => {
    if (env.NODE_ENV === 'production') sendAlert(`BRUTE FORCE: IP ${req.ip} bloqueado.`);
    res.status(429).json({ message: 'IP bloqueado por 15 minutos.' });
  }
});

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5, // max 5 accounts per hour per IP
  handler: (req, res) => {
    if (env.NODE_ENV === 'production') sendAlert(`REGISTER RATE LIMIT: IP ${req.ip} bloqueado.`);
    res.status(429).json({ message: 'Muitas tentativas de registro. Tente novamente mais tarde.' });
  }
});

const shield = (req, res, next) => {
  const userAgent = req.headers['user-agent'] || '';
  const origin = req.headers.origin;
  if (env.NODE_ENV === 'production') {
    if (/PostmanRuntime|Insomnia|curl/i.test(userAgent)) {
      sendAlert(`BLOCK: Ferramenta barrada.\nIP: ${req.ip}`);
      return res.status(403).json({ message: "Acesso bloqueado." });
    }
    if (!origin || !origin.startsWith(env.FRONTEND_URL)) {
      if (req.headers['sec-fetch-site'] !== 'same-origin') {
        sendAlert(`ORIGEM: Acesso de fonte desconhecida.\nOrigin: ${origin}`);
        return res.status(403).json({ message: "Origem nao autorizada." });
      }
    }
  }
  next();
};

const sanitizeInput = (req, res, next) => {
  const sanitize = (obj) => {
    for (const key in obj) {
      if (typeof obj[key] === 'string') {
        obj[key] = obj[key].replace(/</g, "&lt;").replace(/>/g, "&gt;").trim();
      }
    }
  };
  if (req.body) sanitize(req.body);
  next();
};

module.exports = { tmdbApiLimiter, authLimiter, registerLimiter, sanitizeInput, shield, userSpamDetector };