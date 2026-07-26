const previews = new Map();
const profiles = new Map();
const following = new Map();
const PREVIEW_TTL_MS = 2 * 60 * 1000;

const getPreview = (roomId) => { const preview = previews.get(roomId); if (!preview || Date.now() - preview.createdAt > PREVIEW_TTL_MS) { previews.delete(roomId); return null; } return { image: preview.image, updatedAt: preview.updatedAt }; };
const setPreview = (roomId, preview) => previews.set(roomId, { ...preview, createdAt: Date.now(), updatedAt: new Date().toISOString() });
const deletePreview = (roomId) => previews.delete(roomId);
const getCached = (cache, key) => { const item = cache.get(key); if (!item || item.expiresAt < Date.now()) { cache.delete(key); return undefined; } return item.value; };
const setCached = (cache, key, value, ttlMs) => cache.set(key, { value, expiresAt: Date.now() + ttlMs });

module.exports = { getPreview, setPreview, deletePreview, profiles, following, getCached, setCached };
