const env = require('./env');

const isProduction = env.NODE_ENV === 'production';
const AUTH_COOKIE_NAME = isProduction ? '__Host-authToken' : 'authToken';
const LEGACY_AUTH_COOKIE_NAME = 'authToken';
const SESSION_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 5;

const baseCookieOptions = {
  httpOnly: true,
  secure: isProduction,
  sameSite: isProduction ? 'none' : 'lax',
  path: '/',
  priority: 'high',
};

const sessionCookieOptions = {
  ...baseCookieOptions,
  maxAge: SESSION_MAX_AGE_MS,
};

module.exports = {
  AUTH_COOKIE_NAME,
  LEGACY_AUTH_COOKIE_NAME,
  SESSION_MAX_AGE_MS,
  baseCookieOptions,
  sessionCookieOptions,
};
