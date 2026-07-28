const { EventEmitter } = require("events");

const previews = new Map();
const profiles = new Map();
const following = new Map();
const followers = new Map();
const liveRooms = new Set();
const events = new EventEmitter();
const PREVIEW_TTL_MS = 2 * 60 * 1000;
let liveVersion = 0;

const getPreview = (roomId) => {
  const preview = previews.get(roomId);
  if (!preview || Date.now() - preview.createdAt > PREVIEW_TTL_MS) {
    previews.delete(roomId);
    return null;
  }
  return { image: preview.image, updatedAt: preview.updatedAt };
};
const setPreview = (roomId, preview) =>
  previews.set(roomId, {
    ...preview,
    createdAt: Date.now(),
    updatedAt: new Date().toISOString(),
  });
const deletePreview = (roomId) => previews.delete(roomId);
const touchLiveVersion = () => {
  liveVersion += 1;
  events.emit("live-changed", liveVersion);
  return liveVersion;
};
const setLive = (roomId, live) => {
  const changed = live ? !liveRooms.has(roomId) : liveRooms.has(roomId);
  if (live) liveRooms.add(roomId);
  else {
    liveRooms.delete(roomId);
    deletePreview(roomId);
  }
  if (changed) touchLiveVersion();
};
const isLive = (roomId) => liveRooms.has(roomId);
const getLiveRoomIds = () => [...liveRooms];
const getLiveVersion = () => liveVersion;
const getCached = (cache, key) => {
  const item = cache.get(key);
  if (!item || item.expiresAt < Date.now()) {
    cache.delete(key);
    return undefined;
  }
  return item.value;
};
const setCached = (cache, key, value, ttlMs) =>
  cache.set(key, { value, expiresAt: Date.now() + ttlMs });

module.exports = {
  getPreview,
  setPreview,
  deletePreview,
  setLive,
  isLive,
  getLiveRoomIds,
  getLiveVersion,
  touchLiveVersion,
  events,
  profiles,
  following,
  followers,
  getCached,
  setCached,
};
