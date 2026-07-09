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
const { remember } = require("../../shared/cache/cache.service");
const { feedKey } = require("../../shared/cache/cache.keys");
const { getLikedReviewIds } = require("./reviewLikeState.service");

const FEED_PAGE_SIZE = 20;

function buildReviewItems(docs, likedIds, uid, userCache) {
  return docs.map((doc) => {
    const data = doc.data();
    const fallback = userCache[data.userId] || {};

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
      username: safeUsername(data.username) || safeUsername(fallback.username) || "Usuário",
      userPhoto: data.userPhoto || fallback.userPhoto || null,
      levelTitle: data.levelTitle || null,
      isEliteReview: data.isEliteReview || false,
      isEdited: data.isEdited || false,
      isLikedByCurrentUser: likedIds.has(doc.id),
      isOwner: uid ? data.userId === uid : false,
      replies: [],
      type: "review",
    };
  });
}

async function fetchLikedIds(reviewDocs, uid) {
  const reviewIds = reviewDocs.map((doc) => doc.id);
  return getLikedReviewIds(uid, reviewIds);
}

exports.getGlobalFeed = catchAsync(async (req, res, next) => {
  const { uid } = req.user || {};
  const cursorDate = parseCursor(req.query.cursor);
  const cacheKey = feedKey("global", uid, req.query.cursor);

  const payload = await remember(cacheKey, 15, async () => {
    let query = db.collection("reviews").orderBy("createdAt", "desc").limit(FEED_PAGE_SIZE);
    if (cursorDate) query = query.startAfter(cursorDate);

    const snapshot = await query.get();
    const likedIds = await fetchLikedIds(snapshot.docs, uid);
    const userCache = await resolveUsernamesFallback(db, snapshot.docs, (doc) => doc.data());
    const items = buildReviewItems(snapshot.docs, likedIds, uid, userCache);

    return {
      items,
      hasMore: snapshot.docs.length === FEED_PAGE_SIZE,
      nextCursor: buildCursorFromItems(items),
    };
  });

  res.status(200).json(payload);
});

exports.getFollowingFeed = catchAsync(async (req, res, next) => {
  const { uid } = req.user;
  const cursorDate = parseCursor(req.query.cursor);
  const cacheKey = feedKey("following", uid, req.query.cursor);

  const payload = await remember(cacheKey, 15, async () => {
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

    const likedIds = await fetchLikedIds(reviewsSnapshot.docs, uid);
    const reviewUserCache = await resolveUsernamesFallback(db, reviewsSnapshot.docs, (doc) => doc.data());
    const listUserCache = await resolveUsernamesFallback(db, listsSnapshot.docs, (doc) => doc.data());

    const reviews = buildReviewItems(reviewsSnapshot.docs, likedIds, uid, reviewUserCache);
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
  const cacheKey = feedKey("collections", req.user?.uid, req.query.cursor);
  const payload = await remember(cacheKey, 20, async () => {
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
