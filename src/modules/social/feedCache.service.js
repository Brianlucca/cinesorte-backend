const {
  deleteLocalByPrefix,
} = require("../../shared/cache/cache.service");

const invalidateFeedCache = () =>
  Promise.all([
    deleteLocalByPrefix("feed:"),
    deleteLocalByPrefix("public-feed:"),
  ]);

module.exports = { invalidateFeedCache };
