const crypto = require("node:crypto");
const env = require("../../config/env");
const logger = require("../utils/logger");
const {
  AUTH_COOKIE_NAME,
  LEGACY_AUTH_COOKIE_NAME,
  baseCookieOptions,
} = require("../../config/cookies");

const ANONYMOUS_COOKIE_NAME = env.NODE_ENV === "production" ? "__Host-csVisitor" : "csVisitor";
const ANONYMOUS_COOKIE_MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IGNORED_PATHS = new Set([
  "/api/health",
  "/api/health/cache",
  "/api/health/live",
  "/api/health/ready",
]);
const RECENT_EVENT_TTL_MS = 60 * 1000;
const MAX_RECENT_EVENTS = 5000;
const recentEvents = new Map();

const PUBLIC_ACTIONS = [
  [/^\/api\/tmdb\/search$/, "catalog_search"],
  [/^\/api\/tmdb\/details\//, "content_details"],
  [/^\/api\/tmdb\/discover$/, "catalog_discover"],
  [/^\/api\/tmdb\//, "catalog_browse"],
  [/^\/api\/social\/reviews\//, "community_reviews"],
  [/^\/api\/social\/comments\//, "community_comments"],
  [/^\/api\/users\/profile\//, "public_profile"],
];

const hash = (value) => crypto.createHash("sha256").update(value).digest("hex").slice(0, 20);

function hasSessionCookie(req) {
  return Boolean(req.cookies?.[AUTH_COOKIE_NAME] || req.cookies?.[LEGACY_AUTH_COOKIE_NAME]);
}

function getAnonymousId(req, res) {
  const current = req.cookies?.[ANONYMOUS_COOKIE_NAME];
  if (UUID_PATTERN.test(String(current || ""))) return current;

  const id = crypto.randomUUID();
  res.cookie(ANONYMOUS_COOKIE_NAME, id, {
    ...baseCookieOptions,
    maxAge: ANONYMOUS_COOKIE_MAX_AGE_MS,
  });
  return id;
}

function classifyAction(path) {
  return PUBLIC_ACTIONS.find(([pattern]) => pattern.test(path))?.[1] || "public_api";
}

function shouldLog(visitorId, action) {
  const key = `${visitorId}:${action}`;
  const currentTime = Date.now();
  const minimumInterval = action === "catalog_search" ? 5000 : RECENT_EVENT_TTL_MS;
  const previous = recentEvents.get(key) || 0;
  if (currentTime - previous < minimumInterval) return false;

  recentEvents.delete(key);
  recentEvents.set(key, currentTime);
  if (recentEvents.size > MAX_RECENT_EVENTS) {
    recentEvents.delete(recentEvents.keys().next().value);
  }
  return true;
}

function requestTelemetry(req, res, next) {
  const startedAt = process.hrtime.bigint();
  const requestId = crypto.randomUUID();
  const sessionPresent = hasSessionCookie(req);
  const anonymousId = sessionPresent ? null : getAnonymousId(req, res);

  req.requestId = requestId;
  res.setHeader("X-Request-Id", requestId);

  res.once("finish", () => {
    const path = String(req.originalUrl || req.url || "").split("?")[0];
    if (sessionPresent || req.method === "OPTIONS" || !path.startsWith("/api/") || IGNORED_PATHS.has(path)) {
      return;
    }

    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    const searchTerm = path === "/api/tmdb/search" ? String(req.query?.query || "") : "";
    const visitorId = hash(anonymousId);
    const action = classifyAction(path);
    if (!shouldLog(visitorId, action)) return;
    logger.info("anonymous_request", {
      requestId,
      visitorId,
      action,
      method: req.method,
      path,
      status: res.statusCode,
      durationMs: Number(durationMs.toFixed(2)),
      searchLength: searchTerm ? searchTerm.length : undefined,
      userAgent: String(req.headers["user-agent"] || "unknown").slice(0, 180),
    });
  });

  next();
}

module.exports = requestTelemetry;
