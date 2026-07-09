function feedKey(type, userId, cursor = "first") {
  return `feed:${type}:${userId || "anon"}:${cursor || "first"}`;
}

function notificationsListKey(userId) {
  return `notifications:list:${userId}`;
}

function notificationsCountKey(userId) {
  return `notifications:count:${userId}`;
}

module.exports = {
  feedKey,
  notificationsListKey,
  notificationsCountKey,
};
