const rateLimit = require('express-rate-limit');

const tmdbApiLimiter = rateLimit({
    windowMs: 1 * 60 * 1000,
    max: 50,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: 'Muitas requisições. Tente novamente mais tarde.' }
});

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: { message: 'Muitas tentativas de login. Tente novamente em 15 minutos.' }
});

const sanitizeInput = (req, res, next) => {
    const sanitize = (obj) => {
        for (const key in obj) {
            if (typeof obj[key] === 'string') {
                obj[key] = obj[key]
                    .replace(/</g, "&lt;")
                    .replace(/>/g, "&gt;")
                    .replace(/javascript:/gi, "")
                    .trim();
            } else if (typeof obj[key] === 'object' && obj[key] !== null) {
                sanitize(obj[key]);
            }
        }
    };

    if (req.body) sanitize(req.body);
    if (req.query) sanitize(req.query);
    if (req.params) sanitize(req.params);

    next();
};

const validateEmail = (email) => {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(String(email).toLowerCase());
};

const validatePassword = (password) => {
    return password && password.length >= 6;
};

module.exports = { tmdbApiLimiter, authLimiter, sanitizeInput, validateEmail, validatePassword };