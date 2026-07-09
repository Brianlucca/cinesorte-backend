const safeUsername = (val) => (val && val.trim()) ? val.trim() : null;

function getSharedListPreview(data = {}) {
  const rawItems = Array.isArray(data.listItems) ? data.listItems : [];
  return {
    listName: data.listName || "Coleção",
    listCount: Number(data.listCount) || rawItems.length || 0,
    listItems: rawItems.slice(0, 4),
  };
}

async function resolveUsernamesFallback(db, docs, getDataFn) {
  const usersToFetch = new Set();
  docs.forEach((doc) => {
    const data = getDataFn(doc);
    if (!safeUsername(data.username) && data.userId) {
      usersToFetch.add(data.userId);
    }
  });

  const userCache = {};
  if (usersToFetch.size > 0) {
    await Promise.all(
      [...usersToFetch].map(async (userId) => {
        try {
          const userDoc = await db.collection("users").doc(userId).get();
          if (userDoc.exists) {
            const userData = userDoc.data();
            userCache[userId] = {
              username: safeUsername(userData.username) || null,
              userPhoto: userData.photoURL || null,
            };
          }
        } catch {}
      })
    );
  }

  return userCache;
}

function getCreatedAtMillis(value) {
  if (!value) return 0;
  if (typeof value.toDate === "function") return value.toDate().getTime();
  if (value instanceof Date) return value.getTime();
  return new Date(value).getTime();
}

function parseCursor(cursor) {
  if (!cursor) return null;
  const timestamp = Number(cursor);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return null;
  return new Date(timestamp);
}

function buildCursorFromItems(items) {
  if (!Array.isArray(items) || items.length === 0) return null;
  const lastItem = items[items.length - 1];
  return String(getCreatedAtMillis(lastItem.createdAt));
}

module.exports = {
  safeUsername,
  getSharedListPreview,
  resolveUsernamesFallback,
  getCreatedAtMillis,
  parseCursor,
  buildCursorFromItems,
};
