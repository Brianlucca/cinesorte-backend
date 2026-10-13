const { auth, db } = require("../../config/firebase");
const {
  AUTH_COOKIE_NAME,
  LEGACY_AUTH_COOKIE_NAME,
  baseCookieOptions,
} = require("../../config/cookies");
const AppError = require("../errors/AppError");
const catchAsync = require("../utils/catchAsync");
const logger = require("../utils/logger");
const { CURRENT_TERMS_VERSION } = require("../../config/legal");
const { getCachedAuthUser } = require("../../modules/users/userCache.service");

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

  let decodedClaims;
  try {
    decodedClaims = await auth.verifySessionCookie(sessionCookie, true);
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

  if (!decodedClaims.email_verified) return next(new AppError('Verifique seu email.', 403));
  const cachedUser = await getCachedAuthUser(decodedClaims.uid);
  if (!cachedUser.exists) return next(new AppError('Usuário não encontrado.', 404));

  const userData = cachedUser.data;
  req.user = {
    uid: decodedClaims.uid,
    email: decodedClaims.email,
    authTime: decodedClaims.auth_time ? decodedClaims.auth_time * 1000 : null,
    username: userData.username,
    photoURL: userData.photoURL,
    provider: userData.provider || 'email',
  };
  return next();
});

const optionalVerify = catchAsync(async (req, res, next) => {
  const sessionCookie = getSessionCookie(req);
  if (sessionCookie) {
    let decodedClaims;
    try {
      decodedClaims = await auth.verifySessionCookie(sessionCookie, true);
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

    if (decodedClaims) {
      req.user = { uid: decodedClaims.uid, username: null };
      try {
        const cachedUser = await getCachedAuthUser(decodedClaims.uid);
        if (cachedUser.exists) req.user.username = cachedUser.data.username;
      } catch (error) {
        logger.warn('auth_optional_profile_unavailable', {
          uid: decodedClaims.uid,
          message: error?.message || 'unknown',
          route: req.originalUrl,
        });
      }
    }
  }
  return next();
});

const requireTerms = catchAsync(async (req, res, next) => {
  if (!req.user?.uid) return next(new AppError('Acesso negado. Faça login.', 401));
  const snapshot = await db.collection('users').doc(req.user.uid).get();
  if (!snapshot.exists || snapshot.data()?.termsVersion !== CURRENT_TERMS_VERSION) {
    return next(new AppError('Aceite os novos termos.', 403));
  }
  return next();
});

module.exports = { verifyToken, optionalVerify, requireTerms, getSessionCookie, clearSessionCookies };
