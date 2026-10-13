const { db } = require("../../config/firebase");
const env = require("../../config/env");
const { rememberLocal, delLocal } = require("../../shared/cache/cache.service");
const { authUserKey } = require("../../shared/cache/cache.keys");

const AUTH_USER_TTL_SECONDS = Math.max(
  60,
  Number(env.AUTH_USER_CACHE_TTL_SECONDS || 900),
);

function selectAuthUser(data = {}) {
  return {
    username: data.username || null,
    photoURL: data.photoURL || null,
    provider: data.provider || "email",
  };
}

async function getCachedAuthUser(userId) {
  return rememberLocal(authUserKey(userId), AUTH_USER_TTL_SECONDS, async () => {
    const snapshot = await db.collection("users").doc(userId).get();
    return snapshot.exists
      ? { exists: true, data: selectAuthUser(snapshot.data()) }
      : { exists: false, data: null };
  });
}

const invalidateUserCache = (userId) => delLocal(authUserKey(userId));

module.exports = {
  getCachedAuthUser,
  invalidateUserCache,
};
