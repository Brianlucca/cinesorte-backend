const { db } = require("../../config/firebase");
const catchAsync = require("../../shared/utils/catchAsync");
const {
  safeUsername,
  getSharedListPreview,
  resolveUsernamesFallback,
  getCreatedAtMillis,
  parseCursor,
  buildCursorFromItems,
} = require("./socialFeed.service");
const { rememberLocal } = require("../../shared/cache/cache.service");
const { feedKey, publicFeedKey } = require("../../shared/cache/cache.keys");
const { getLikedReviewIds } = require("./reviewLikeState.service");

const FEED_PAGE_SIZE = 20;

function buildPublicReviewItems(docs, userCache) {
  return docs.map((doc) => {
    const data = doc.data();
    const fallback = userCache[data.userId] || {};
    const ownerUsername =
      safeUsername(data.username) ||
      safeUsername(fallback.username) ||
      "Usuário";

    return {
      id: doc.id,
      mediaId: data.mediaId,
      mediaType: data.mediaType,
      mediaTitle: data.mediaTitle,
      posterPath: data.posterPath || null,
      backdropPath: data.backdropPath || null,
      rating: data.rating,
      text: data.text || null,
      likesCount: data.likesCount || 0,
      commentsCount: data.commentsCount || 0,
      createdAt: data.createdAt,
      username: ownerUsername,
      userPhoto: data.userPhoto || fallback.userPhoto || null,
      levelTitle: data.levelTitle || null,
      isEliteReview: data.isEliteReview || false,
      isEdited: data.isEdited || false,
      replies: [],
      type: "review",
      _ownerUsername: ownerUsername,
    };
  });
}

async function personalizeReviewItems(items, user) {
  const reviewIds = items.map((item) => item.id);
  const likedIds = await getLikedReviewIds(user.uid, reviewIds);
  return items.map(({ _ownerUsername, ...item }) => ({
    ...item,
    isLikedByCurrentUser: likedIds.has(item.id),
    isOwner: Boolean(user.username && _ownerUsername === user.username),
  }));
}

exports.getGlobalFeed = catchAsync(async (req, res, next) => {
  const { uid } = req.user;
  const cursorDate = parseCursor(req.query.cursor);
  const cursor = req.query.cursor || "first";

  const publicPayload = await rememberLocal(publicFeedKey("global", cursor), 300, async () => {
    let query = db.collection("reviews").orderBy("createdAt", "desc").limit(FEED_PAGE_SIZE);
    if (cursorDate) query = query.startAfter(cursorDate);

    const snapshot = await query.get();
    const userCache = await resolveUsernamesFallback(db, snapshot.docs, (doc) => doc.data());
    const items = buildPublicReviewItems(snapshot.docs, userCache);

    return {
      items,
      hasMore: snapshot.docs.length === FEED_PAGE_SIZE,
      nextCursor: buildCursorFromItems(items),
    };
  });
  const payload = await rememberLocal(feedKey("global", uid, cursor), 300, async () => ({
    ...publicPayload,
    items: await personalizeReviewItems(publicPayload.items, req.user),
  }));

  res.status(200).json(payload);
});

exports.getFollowingFeed = catchAsync(async (req, res, next) => {
  const { uid } = req.user;
  const cursorDate = parseCursor(req.query.cursor);
  const cacheKey = feedKey("following", uid, req.query.cursor);

  const payload = await rememberLocal(cacheKey, 300, async () => {
    const followingSnap = await db
      .collection("users")
      .doc(uid)
      .collection("following")
      .limit(30)
      .get();

    if (followingSnap.empty) {
      return { items: [], hasMore: false, nextCursor: null };
    }

    const followingIds = followingSnap.docs.map((doc) => doc.id).filter((id) => id !== uid);
    if (followingIds.length === 0) {
      return { items: [], hasMore: false, nextCursor: null };
    }

    const activeIds = followingIds.slice(0, 30);
    const queryWindow = FEED_PAGE_SIZE * 2;

    let reviewsQuery = db
      .collection("reviews")
      .where("userId", "in", activeIds)
      .orderBy("createdAt", "desc")
      .limit(queryWindow);

    let listsQuery = db
      .collection("shared_lists")
      .where("userId", "in", activeIds)
      .orderBy("createdAt", "desc")
      .limit(queryWindow);

    if (cursorDate) {
      reviewsQuery = reviewsQuery.startAfter(cursorDate);
      listsQuery = listsQuery.startAfter(cursorDate);
    }

    const [reviewsSnapshot, listsSnapshot] = await Promise.all([
      reviewsQuery.get(),
      listsQuery.get(),
    ]);

    const reviewUserCache = await resolveUsernamesFallback(db, reviewsSnapshot.docs, (doc) => doc.data());
    const listUserCache = await resolveUsernamesFallback(db, listsSnapshot.docs, (doc) => doc.data());

    const publicReviews = buildPublicReviewItems(reviewsSnapshot.docs, reviewUserCache);
    const reviews = await personalizeReviewItems(publicReviews, req.user);
    const sharedLists = listsSnapshot.docs.map((doc) => {
      const data = doc.data();
      const fallback = listUserCache[data.userId] || {};
      const preview = getSharedListPreview(data);

      return {
        id: doc.id,
        username: safeUsername(data.username) || safeUsername(fallback.username) || "Usuário",
        userPhoto: data.userPhoto || fallback.userPhoto || null,
        listName: preview.listName,
        listCount: preview.listCount,
        listItems: preview.listItems,
        attachmentId: data.listId,
        createdAt: data.createdAt,
        type: "list_share",
        content: data.content,
        likesCount: data.likesCount || 0,
        isOwner: uid ? data.userId === uid : false,
      };
    });

    const mergedItems = [...reviews, ...sharedLists].sort(
      (a, b) => getCreatedAtMillis(b.createdAt) - getCreatedAtMillis(a.createdAt)
    );

    const items = mergedItems.slice(0, FEED_PAGE_SIZE);

    return {
      items,
      hasMore:
        mergedItems.length > FEED_PAGE_SIZE ||
        reviewsSnapshot.docs.length === queryWindow ||
        listsSnapshot.docs.length === queryWindow,
      nextCursor: buildCursorFromItems(items),
    };
  });

  res.status(200).json(payload);
});

exports.getSharedListsFeed = catchAsync(async (req, res, next) => {
  const cursorDate = parseCursor(req.query.cursor);
  const cacheKey = publicFeedKey("collections", req.query.cursor);
  const payload = await rememberLocal(cacheKey, 300, async () => {
    let query = db
      .collection("shared_lists")
      .orderBy("createdAt", "desc")
      .limit(FEED_PAGE_SIZE);

    if (cursorDate) query = query.startAfter(cursorDate);

    const snapshot = await query.get();
    const userCache = await resolveUsernamesFallback(db, snapshot.docs, (doc) => doc.data());

    const items = snapshot.docs
      .map((doc) => {
        const data = doc.data();
        const fallback = userCache[data.userId] || {};
        const preview = getSharedListPreview(data);

        return {
          id: doc.id,
          username: safeUsername(data.username) || safeUsername(fallback.username) || "Usuário",
          userPhoto: data.userPhoto || fallback.userPhoto || null,
          listName: preview.listName,
          listCount: preview.listCount,
          listItems: preview.listItems,
          attachmentId: data.listId,
          createdAt: data.createdAt,
          type: "list_share",
          content: data.content,
          likesCount: data.likesCount || 0,
        };
      })
      .sort((a, b) => getCreatedAtMillis(b.createdAt) - getCreatedAtMillis(a.createdAt));

    return {
      items,
      hasMore: snapshot.docs.length === FEED_PAGE_SIZE,
      nextCursor: buildCursorFromItems(items),
    };
  });

  res.status(200).json(payload);
});
