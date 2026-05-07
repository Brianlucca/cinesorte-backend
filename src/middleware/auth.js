const { auth, db } = require('../config/firebase');
const {
  AUTH_COOKIE_NAME,
  LEGACY_AUTH_COOKIE_NAME,
  baseCookieOptions,
} = require('../config/cookies');
const AppError = require('../utils/AppError');
const catchAsync = require('../utils/catchAsync');
const logger = require('../utils/logger');

const getSessionCookie = (req) => {
  if (!req.cookies) return null;
  return req.cookies[AUTH_COOKIE_NAME] || req.cookies[LEGACY_AUTH_COOKIE_NAME] || null;
};

const clearSessionCookies = (res) => {
  res.clearCookie(AUTH_COOKIE_NAME, baseCookieOptions);
  if (AUTH_COOKIE_NAME !== LEGACY_AUTH_COOKIE_NAME) {
    res.clearCookie(LEGACY_AUTH_COOKIE_NAME, baseCookieOptions);
  }
};

const verifyToken = catchAsync(async (req, res, next) => {
  const sessionCookie = getSessionCookie(req);
  if (!sessionCookie) return next(new AppError('Acesso negado. Faça login.', 401));

  try {
    const decodedClaims = await auth.verifySessionCookie(sessionCookie, true);
    if (!decodedClaims.email_verified) return next(new AppError('Verifique seu email.', 403));

    const userDoc = await db.collection('users').doc(decodedClaims.uid).get();
    if (!userDoc.exists) return next(new AppError('Usuário não encontrado.', 404));

    const userData = userDoc.data();
    req.user = {
      uid: decodedClaims.uid,
      email: decodedClaims.email,
      authTime: decodedClaims.auth_time ? decodedClaims.auth_time * 1000 : null,
      username: userData.username,
      photoURL: userData.photoURL,
      role: userData.role,
      termsVersion: userData.termsVersion,
    };
    next();
  } catch (error) {
    logger.warn('auth_session_invalid', {
      code: error?.code || 'unknown',
      message: error?.message || 'unknown',
      ip: req.ip || 'unknown',
      userAgent: req.headers['user-agent'] || 'unknown',
      route: req.originalUrl,
      method: req.method,
    });
    clearSessionCookies(res);
    return next(new AppError('Sessão inválida.', 401));
  }
});

const optionalVerify = catchAsync(async (req, res, next) => {
  const sessionCookie = getSessionCookie(req);
  if (sessionCookie) {
    try {
      const decodedClaims = await auth.verifySessionCookie(sessionCookie, true);
      req.user = { uid: decodedClaims.uid };
    } catch (error) {
      logger.warn('auth_optional_session_invalid', {
        code: error?.code || 'unknown',
        message: error?.message || 'unknown',
        ip: req.ip || 'unknown',
        userAgent: req.headers['user-agent'] || 'unknown',
        route: req.originalUrl,
        method: req.method,
      });
      clearSessionCookies(res);
      req.user = null;
    }
  }
  next();
});

const requireTerms = (req, res, next) => {
  const CURRENT_TERMS_VERSION = '4.0';
  if (!req.user || req.user.termsVersion !== CURRENT_TERMS_VERSION) {
    return next(new AppError('Aceite os novos termos.', 403));
  }
  next();
};

module.exports = { verifyToken, optionalVerify, requireTerms, getSessionCookie, clearSessionCookies };
