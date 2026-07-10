const memoryCache = new Map();
const pendingFactories = new Map();
const DEFAULT_TTL_SECONDS = 15;
const MAX_CACHE_ENTRIES = Number(process.env.MEMORY_CACHE_MAX_ENTRIES || 500);

function now() {
  return Date.now();
}

function pruneExpiredEntries() {
  const currentTime = now();
  for (const [key, entry] of memoryCache.entries()) {
    if (entry.expiresAt <= currentTime) {
      memoryCache.delete(key);
    }
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
  if (memoryCache.has(key)) {
    memoryCache.delete(key);
  }

  memoryCache.set(key, {
    value,
    expiresAt: now() + ttlSeconds * 1000,
  });
  enforceMaxEntries();
}

async function get(key) {
  return getMemoryEntry(key);
}

async function set(key, value, ttlSeconds = DEFAULT_TTL_SECONDS) {
  setMemoryEntry(key, value, ttlSeconds);
}

async function del(key) {
  memoryCache.delete(key);
}

async function deleteByPrefix(prefix) {
  pruneExpiredEntries();

  for (const key of memoryCache.keys()) {
    if (key.startsWith(prefix)) {
      memoryCache.delete(key);
    }
  }
}

async function remember(key, ttlSeconds, factory) {
  const cached = await get(key);
  if (cached !== null) return cached;
  if (pendingFactories.has(key)) return pendingFactories.get(key);

  const pending = Promise.resolve()
    .then(factory)
    .then(async (value) => {
      await set(key, value, ttlSeconds);
      return value;
    })
    .finally(() => pendingFactories.delete(key));

  pendingFactories.set(key, pending);
  return pending;
}

module.exports = {
  get,
  set,
  del,
  deleteByPrefix,
  remember,
};
