const { delLocal } = require("../../shared/cache/cache.service");
const {
  notificationsCountKey,
  notificationsListKey,
} = require("../../shared/cache/cache.keys");

const invalidateNotificationCache = (userId) => {
  if (!userId) return Promise.resolve();
  return Promise.all([
    delLocal(notificationsListKey(userId)),
    delLocal(notificationsCountKey(userId)),
  ]);
};

module.exports = { invalidateNotificationCache };
