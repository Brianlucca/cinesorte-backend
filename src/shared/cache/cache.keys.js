const crypto = require("node:crypto");

function feedKey(type, userId, cursor = "first") {
  return `feed:${type}:${userId || "anon"}:${cursor || "first"}`;
}

function publicFeedKey(type, cursor = "first") {
  return `public-feed:${type}:${cursor || "first"}`;
}

function notificationsListKey(userId) {
  return `notifications:list:${userId}`;
}

function notificationsCountKey(userId) {
  return `notifications:count:${userId}`;
}

const safePart = (value) => encodeURIComponent(String(value || "").trim().toLowerCase());
const safeUserId = (value) => encodeURIComponent(String(value || "").trim());
const hashPart = (value) =>
  crypto.createHash("sha256").update(String(value || "")).digest("hex").slice(0, 24);

const authUserKey = (userId) => `user:auth:${safePart(userId)}`;
const publicProfileKey = (username) => `profile:public:${safePart(username)}`;
const userSearchKey = (query) => `users:search:${hashPart(query)}`;
const userInteractionsKey = (userId) =>
  `user-options:interactions:${safeUserId(userId)}`;
const mediaInteractionKey = (userId, mediaId) =>
  `user-options:interaction:${safeUserId(userId)}:${safePart(mediaId)}`;
const userListsKey = (userId) => `user-options:lists:${safeUserId(userId)}`;
const mediaReviewsKey = (mediaId) => `reviews:media:${safePart(mediaId)}`;
const mediaLikedReviewsKey = (userId, mediaId) =>
  `reviews:likes:${safeUserId(userId)}:${safePart(mediaId)}`;
const reviewCommentsKey = (reviewId) => `reviews:comments:${safePart(reviewId)}`;
const watchProgressListKey = (userId, scope = "web") =>
  `watch-progress:list:${safePart(userId)}:${safePart(scope)}`;
const extensionProgressKey = (userId, progressId) =>
  `extension:progress:${safePart(userId)}:${safePart(progressId)}`;
const extensionStatusKey = (userId) => `extension:status:${safePart(userId)}`;
const personalizedRecommendationsKey = (userId, mediaType, page = 1) =>
  `recommendations:user:${safePart(userId)}:${safePart(mediaType)}:${safePart(page)}`;
const socialListKey = (ownerUid, collectionName) =>
  `social:list:${safeUserId(ownerUid)}:${safePart(collectionName)}`;

module.exports = {
  feedKey,
  publicFeedKey,
  notificationsListKey,
  notificationsCountKey,
  authUserKey,
  publicProfileKey,
  userSearchKey,
  userInteractionsKey,
  mediaInteractionKey,
  userListsKey,
  mediaReviewsKey,
  mediaLikedReviewsKey,
  reviewCommentsKey,
  watchProgressListKey,
  extensionProgressKey,
  extensionStatusKey,
  personalizedRecommendationsKey,
  socialListKey,
};
