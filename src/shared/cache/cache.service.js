const { createClient } = require("redis");
const env = require("../../config/env");
const logger = require("../utils/logger");

const memoryCache = new Map();
const pendingFactories = new Map();
const DEFAULT_TTL_SECONDS = 60;
const MAX_CACHE_ENTRIES = Math.max(100, Number(env.MEMORY_CACHE_MAX_ENTRIES || 2000));
const L1_MAX_TTL_SECONDS = Math.max(1, Number(env.CACHE_L1_MAX_TTL_SECONDS || 600));
const STALE_TTL_SECONDS = Math.max(0, Number(env.CACHE_STALE_TTL_SECONDS || 300));
const METRICS_INTERVAL_MS = Math.max(30000, Number(env.CACHE_METRICS_INTERVAL_MS || 60000));
const REDIS_RETRY_DELAY_MS = 30000;
const CACHE_PREFIX = env.CACHE_KEY_PREFIX;

const metrics = {
  l1Hits: 0,
  l2Hits: 0,
  misses: 0,
  loads: 0,
  staleFallbacks: 0,
  redisErrors: 0,
  sets: 0,
  deletes: 0,
};

let redisClient = null;
let redisConnectPromise = null;
let redisRetryAfter = 0;
let lastRedisErrorLogAt = 0;
let lastMetricsSignature = "";

const now = () => Date.now();
const namespacedKey = (key) => `${CACHE_PREFIX}:${key}`;

function toPositiveTtl(value, fallback = DEFAULT_TTL_SECONDS) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function logRedisError(error) {
  metrics.redisErrors += 1;
  if (now() - lastRedisErrorLogAt < REDIS_RETRY_DELAY_MS) return;
  lastRedisErrorLogAt = now();
  logger.warn("cache_redis_unavailable", {
    message: error?.message || "unknown",
    fallback: "memory",
  });
}

function suspendRedis(error) {
  redisRetryAfter = now() + REDIS_RETRY_DELAY_MS;
  logRedisError(error);
  const failedClient = redisClient;
  redisClient = null;
  if (failedClient?.isOpen) {
    try {
      failedClient.destroy();
    } catch {
      // The memory cache remains available while Redis is suspended.
    }
  }
}

function readMemoryEntry(key, { allowStale = false } = {}) {
  const entry = memoryCache.get(key);
  if (!entry) return { found: false, value: null };

  const currentTime = now();
  if (entry.expiresAt > currentTime) {
    memoryCache.delete(key);
    memoryCache.set(key, entry);
    return { found: true, value: entry.value, stale: false };
  }

  if (allowStale && entry.staleUntil > currentTime) {
    return { found: true, value: entry.value, stale: true };
  }

  if (entry.staleUntil <= currentTime) memoryCache.delete(key);
  return { found: false, value: null };
}

function pruneExpiredEntries() {
  const currentTime = now();
  for (const [key, entry] of memoryCache.entries()) {
    if (entry.staleUntil <= currentTime) memoryCache.delete(key);
  }
}

function enforceMaxEntries() {
  if (memoryCache.size <= MAX_CACHE_ENTRIES) return;
  pruneExpiredEntries();
  while (memoryCache.size > MAX_CACHE_ENTRIES) {
    const oldestKey = memoryCache.keys().next().value;
    if (!oldestKey) break;
    memoryCache.delete(oldestKey);
  }
}

function setMemoryEntry(key, value, ttlSeconds) {
  const l1TtlSeconds = Math.min(toPositiveTtl(ttlSeconds), L1_MAX_TTL_SECONDS);
  const expiresAt = now() + l1TtlSeconds * 1000;
  memoryCache.delete(key);
  memoryCache.set(key, {
    value,
    expiresAt,
    staleUntil: expiresAt + STALE_TTL_SECONDS * 1000,
  });
  enforceMaxEntries();
}

async function getRedisClient() {
  if (!env.REDIS_URL || now() < redisRetryAfter) return null;
  if (redisClient?.isReady) return redisClient;
  if (redisConnectPromise) return redisConnectPromise;

  if (!redisClient) {
    redisClient = createClient({
      url: env.REDIS_URL,
      socket: {
        connectTimeout: 5000,
        reconnectStrategy: false,
      },
    });
    redisClient.on("error", logRedisError);
  }

  redisConnectPromise = redisClient
    .connect()
    .then(() => {
      logger.info("cache_redis_connected", { prefix: CACHE_PREFIX });
      return redisClient;
    })
    .catch((error) => {
      suspendRedis(error);
      return null;
    })
    .finally(() => {
      redisConnectPromise = null;
    });

  return redisConnectPromise;
}

async function checkRedis() {
  if (!env.REDIS_URL) return "not_configured";
  const client = await getRedisClient();
  if (!client) return "unavailable";

  try {
    await client.ping();
    return "ok";
  } catch (error) {
    suspendRedis(error);
    return "unavailable";
  }
}

async function readRedis(key) {
  const client = await getRedisClient();
  if (!client) return null;

  try {
    const raw = await client.get(namespacedKey(key));
    if (raw === null) return null;
    const entry = JSON.parse(raw);
    if (!entry || !("value" in entry)) return null;
    const remainingTtlSeconds = Math.max(
      1,
      Math.ceil((Number(entry.expiresAt) - now()) / 1000),
    );
    return { value: entry.value, remainingTtlSeconds };
  } catch (error) {
    suspendRedis(error);
    return null;
  }
}

async function writeRedis(key, value, ttlSeconds) {
  const client = await getRedisClient();
  if (!client) return;

  try {
    await client.set(namespacedKey(key), JSON.stringify({
      value,
      expiresAt: now() + toPositiveTtl(ttlSeconds) * 1000,
    }), {
      EX: toPositiveTtl(ttlSeconds),
    });
  } catch (error) {
    suspendRedis(error);
  }
}

async function get(key, { shared = true } = {}) {
  const memoryEntry = readMemoryEntry(key);
  if (memoryEntry.found) {
    metrics.l1Hits += 1;
    return memoryEntry.value;
  }

  if (!shared) {
    metrics.misses += 1;
    return null;
  }

  const redisEntry = await readRedis(key);
  if (redisEntry !== null) {
    metrics.l2Hits += 1;
    setMemoryEntry(key, redisEntry.value, redisEntry.remainingTtlSeconds);
    return redisEntry.value;
  }

  metrics.misses += 1;
  return null;
}

async function set(key, value, ttlSeconds = DEFAULT_TTL_SECONDS, { shared = true } = {}) {
  const ttl = toPositiveTtl(ttlSeconds);
  setMemoryEntry(key, value, ttl);
  metrics.sets += 1;
  if (shared) {
    void writeRedis(key, value, ttl).catch(suspendRedis);
  }
}

async function del(key, { shared = true } = {}) {
  memoryCache.delete(key);
  metrics.deletes += 1;
  if (!shared) return;
  const client = await getRedisClient();
  if (!client) return;
  try {
    await client.del(namespacedKey(key));
  } catch (error) {
    suspendRedis(error);
  }
}

async function deleteByPrefix(prefix, { shared = true } = {}) {
  pruneExpiredEntries();
  for (const key of memoryCache.keys()) {
    if (key.startsWith(prefix)) memoryCache.delete(key);
  }

  if (!shared) return;
  const client = await getRedisClient();
  if (!client) return;
  try {
    for await (const result of client.scanIterator({
      MATCH: `${namespacedKey(prefix)}*`,
      COUNT: 100,
    })) {
      const keys = Array.isArray(result) ? result : [result];
      if (keys.length > 0) await client.unlink(keys);
    }
    metrics.deletes += 1;
  } catch (error) {
    suspendRedis(error);
  }
}

async function remember(key, ttlSeconds, factory, { shared = true } = {}) {
  const cached = await get(key, { shared });
  if (cached !== null) return cached;
  const pendingKey = `${shared ? "shared" : "local"}:${key}`;
  if (pendingFactories.has(pendingKey)) return pendingFactories.get(pendingKey);

  const pending = Promise.resolve()
    .then(() => {
      metrics.loads += 1;
      return factory();
    })
    .then(async (value) => {
      await set(key, value, ttlSeconds, { shared });
      return value;
    })
    .catch((error) => {
      const stale = readMemoryEntry(key, { allowStale: true });
      if (stale.found) {
        metrics.staleFallbacks += 1;
        logger.warn("cache_stale_fallback", { key, message: error?.message || "unknown" });
        return stale.value;
      }
      throw error;
    })
    .finally(() => pendingFactories.delete(pendingKey));

  pendingFactories.set(pendingKey, pending);
  return pending;
}

const rememberLocal = (key, ttlSeconds, factory) =>
  remember(key, ttlSeconds, factory, { shared: false });

const delLocal = (key) => del(key, { shared: false });
const deleteLocalByPrefix = (prefix) =>
  deleteByPrefix(prefix, { shared: false });

function getStatus() {
  return {
    redisConfigured: Boolean(env.REDIS_URL),
    redisReady: Boolean(redisClient?.isReady),
    memoryEntries: memoryCache.size,
    pendingLoads: pendingFactories.size,
    metrics: { ...metrics },
  };
}

async function close() {
  clearInterval(metricsTimer);
  if (!redisClient?.isOpen) return;
  try {
    await redisClient.quit();
  } catch {
    redisClient.destroy();
  }
}

const metricsTimer = setInterval(() => {
  const activity = Object.values(metrics).some((value) => value > 0);
  if (!activity) return;
  const status = getStatus();
  const signature = JSON.stringify(status);
  if (signature === lastMetricsSignature) return;
  lastMetricsSignature = signature;
  logger.info("cache_metrics", status);
}, METRICS_INTERVAL_MS);
if (typeof metricsTimer.unref === "function") metricsTimer.unref();

module.exports = {
  get,
  set,
  del,
  deleteByPrefix,
  remember,
  rememberLocal,
  delLocal,
  deleteLocalByPrefix,
  getStatus,
  checkRedis,
  close,
};
