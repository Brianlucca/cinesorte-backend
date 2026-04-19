const env = require("../config/env");
const logger = require("../utils/logger");

const memoryCache = new Map();
const DEFAULT_TTL_SECONDS = 15;
const REDIS_CONNECT_TIMEOUT_MS = 500;
const REDIS_OPERATION_TIMEOUT_MS = 150;
const REDIS_DISABLE_WINDOW_MS = 60000;

let redisClientPromise = null;
let redisDisabledUntil = 0;
let redisFailureLoggedAt = 0;

function now() {
  return Date.now();
}

function withTimeout(promise, timeoutMs, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timeout after ${timeoutMs}ms`)), timeoutMs)
    ),
  ]);
}

function shouldSkipRedis() {
  return !env.REDIS_URL || redisDisabledUntil > now();
}

function markRedisUnavailable(error) {
  redisDisabledUntil = now() + REDIS_DISABLE_WINDOW_MS;
  redisClientPromise = null;

  if (now() - redisFailureLoggedAt > 10000) {
    redisFailureLoggedAt = now();
    logger.error("Redis unavailable, falling back to memory cache: %s", error?.message || error);
  }
}

async function getRedisClient() {
  if (shouldSkipRedis()) return null;
  if (redisClientPromise) return redisClientPromise;

  redisClientPromise = (async () => {
    try {
      const { createClient } = require("redis");
      const client = createClient({
        url: env.REDIS_URL,
        socket: {
          connectTimeout: REDIS_CONNECT_TIMEOUT_MS,
          tls: env.REDIS_URL.startsWith("rediss://"),
        },
      });

      client.on("error", (error) => {
        markRedisUnavailable(error);
      });

      await withTimeout(client.connect(), REDIS_CONNECT_TIMEOUT_MS, "redis connect");
      return client;
    } catch (error) {
      markRedisUnavailable(error);
      return null;
    }
  })();

  return redisClientPromise;
}

function getMemoryEntry(key) {
  const entry = memoryCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= now()) {
    memoryCache.delete(key);
    return null;
  }
  return entry.value;
}

function setMemoryEntry(key, value, ttlSeconds) {
  memoryCache.set(key, {
    value,
    expiresAt: now() + ttlSeconds * 1000,
  });
}

async function safeRedisOperation(operation) {
  const client = await getRedisClient();
  if (!client) return null;

  try {
    return await withTimeout(operation(client), REDIS_OPERATION_TIMEOUT_MS, "redis operation");
  } catch (error) {
    markRedisUnavailable(error);
    return null;
  }
}

async function get(key) {
  const memoryValue = getMemoryEntry(key);
  if (memoryValue !== null) {
    return memoryValue;
  }

  const redisValue = await safeRedisOperation((client) => client.get(key));
  if (typeof redisValue === "string") {
    try {
      const parsedValue = JSON.parse(redisValue);
      setMemoryEntry(key, parsedValue, DEFAULT_TTL_SECONDS);
      return parsedValue;
    } catch (error) {
      markRedisUnavailable(error);
    }
  }

  return null;
}

async function set(key, value, ttlSeconds = DEFAULT_TTL_SECONDS) {
  setMemoryEntry(key, value, ttlSeconds);
  safeRedisOperation((client) =>
    client.set(key, JSON.stringify(value), { EX: ttlSeconds })
  ).catch(() => null);
}

async function del(key) {
  memoryCache.delete(key);
  safeRedisOperation((client) => client.del(key)).catch(() => null);
}

async function deleteByPrefix(prefix) {
  for (const key of memoryCache.keys()) {
    if (key.startsWith(prefix)) {
      memoryCache.delete(key);
    }
  }

  safeRedisOperation(async (client) => {
    for await (const key of client.scanIterator({ MATCH: `${prefix}*` })) {
      await withTimeout(client.del(key), REDIS_OPERATION_TIMEOUT_MS, "redis delete");
    }
    return true;
  }).catch(() => null);
}

async function remember(key, ttlSeconds, factory) {
  const cached = await get(key);
  if (cached !== null) return cached;

  const value = await factory();
  await set(key, value, ttlSeconds);
  return value;
}

module.exports = {
  get,
  set,
  del,
  deleteByPrefix,
  remember,
};
