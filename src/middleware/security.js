const rateLimit = require("express-rate-limit");
const env = require("../config/env");
const { sendAlert } = require("../services/telegramService");

const userTracker = new Map();
const SAFE_HTTP_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

const trackerCleanupInterval = setInterval(() => {
  const now = Date.now();
  for (const [key, val] of userTracker.entries()) {
    if (now - val.start > 120000) userTracker.delete(key);
  }
}, 60000);

if (typeof trackerCleanupInterval.unref === "function") {
  trackerCleanupInterval.unref();
}

const normalizeOrigin = (value) => {
  if (!value) return "";
  try {
    return new URL(value).origin.replace(/\/$/, "");
  } catch {
    return String(value).replace(/\/$/, "");
  }
};

const allowedOrigin = normalizeOrigin(env.FRONTEND_URL);

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
      sendAlert(
        `SUSPEITA DE SPAM\n\nUser: @${username}\nReq/min: ${userData.count}\nIP: ${req.ip}`
      );
      userData.count = 0;
    }
  }
  next();
};

const tmdbApiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 200,
  message: { message: "Muitas requisições." },
});

const messageLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 180,
  message: { message: "Muitas acoes de mensagem. Tente novamente em instantes." },
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  handler: (req, res) => {
    if (env.NODE_ENV === "production")
      sendAlert(`BRUTE FORCE: IP ${req.ip} bloqueado.`);
    res.status(429).json({ message: "IP bloqueado por 15 minutos." });
  },
});

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  handler: (req, res) => {
    if (env.NODE_ENV === "production")
      sendAlert(`REGISTER RATE LIMIT: IP ${req.ip} bloqueado.`);
    res
      .status(429)
      .json({ message: "Muitas tentativas de registro. Tente novamente mais tarde." });
  },
});

const verificationEmailLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 3,
  handler: (req, res) => {
    if (env.NODE_ENV === "production")
      sendAlert(`VERIFICATION EMAIL RATE LIMIT: IP ${req.ip} bloqueado.`);
    res.status(429).json({ message: "Muitas solicitações. Tente novamente mais tarde." });
  },
});

const BLOCKED_UA = /PostmanRuntime|Insomnia|curl/i;

const shield = (req, res, next) => {
  const userAgent = req.headers["user-agent"] || "";
  const origin = req.headers.origin;

  if (env.NODE_ENV === "production") {
    if (BLOCKED_UA.test(userAgent)) {
      sendAlert(`BLOCK: Ferramenta barrada.\nIP: ${req.ip}`);
      return res.status(403).json({ message: "Acesso bloqueado." });
    }

    const isPublicTmdbRoute =
      req.originalUrl.startsWith("/api/tmdb/details") && req.method === "GET";

    if (!isPublicTmdbRoute) {
      const normalizedOrigin = normalizeOrigin(origin);

      if (normalizedOrigin !== allowedOrigin) {
        if (req.headers["sec-fetch-site"] !== "same-origin") {
          sendAlert(`ORIGEM: Acesso de fonte desconhecida.\nOrigin: ${origin}`);
          return res.status(403).json({ message: "Origem não autorizada." });
        }
      }
    }
  }
  next();
};

const protectStateChangingRequests = (req, res, next) => {
  if (env.NODE_ENV !== "production" || SAFE_HTTP_METHODS.has(req.method)) {
    return next();
  }

  const requestOrigin = normalizeOrigin(req.headers.origin);
  const refererOrigin = normalizeOrigin(req.headers.referer);

  if (requestOrigin === allowedOrigin || refererOrigin === allowedOrigin) {
    return next();
  }

  sendAlert(
    `CSRF/ORIGIN BLOQUEADA\n\nMetodo: ${req.method}\nRota: ${req.originalUrl}\nOrigin: ${req.headers.origin || "ausente"}\nReferer: ${req.headers.referer || "ausente"}\nIP: ${req.ip}`
  );
  return res.status(403).json({ message: "Origem não autorizada." });
};

const DANGEROUS_PATTERNS = [
  /<script[\s\S]*?>/i,
  /javascript\s*:/i,
  /on\w+\s*=/i,
  /\$\{[\s\S]*?\}/,
  /<!--[\s\S]*?-->/,
];

function deepSanitize(obj, depth = 0) {
  if (depth > 10) return obj;
  if (typeof obj === "string") {
    for (const pattern of DANGEROUS_PATTERNS) {
      if (pattern.test(obj)) return "";
    }
    return obj.trim();
  }
  if (Array.isArray(obj)) {
    return obj.map((item) => deepSanitize(item, depth + 1));
  }
  if (obj !== null && typeof obj === "object") {
    const sanitized = {};
    for (const key of Object.keys(obj)) {
      sanitized[key] = deepSanitize(obj[key], depth + 1);
    }
    return sanitized;
  }
  return obj;
}

const sanitizeInput = (req, res, next) => {
  if (req.body && typeof req.body === "object") {
    req.body = deepSanitize(req.body);
  }
  next();
};

module.exports = {
  tmdbApiLimiter,
  messageLimiter,
  authLimiter,
  registerLimiter,
  verificationEmailLimiter,
  sanitizeInput,
  shield,
  protectStateChangingRequests,
  userSpamDetector,
  userTracker,
};
