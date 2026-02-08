const { db } = require("../config/firebase");
const catchAsync = require("../utils/catchAsync");

exports.getGlobalFeed = catchAsync(async (req, res, next) => {
  const { uid } = req.user || {};
  const page = parseInt(req.query.page) || 1;
  const limit = 20;
  const offset = (page - 1) * limit;

  let query = db.collection("reviews")
    .orderBy("createdAt", "desc")
    .limit(limit)
    .offset(offset);

  const snapshot = await query.get();
  const feed = await Promise.all(
    snapshot.docs.map(async (doc) => {
      const data = doc.data();
      let isLikedByCurrentUser = false;
      if (uid) {
        const likeSnap = await db
          .collection("reviews")
          .doc(doc.id)
          .collection("likes")
          .doc(uid)
          .get();
        isLikedByCurrentUser = likeSnap.exists;
      }
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
        username: data.username || 'Usuário',
        userPhoto: data.userPhoto || null,
        levelTitle: data.levelTitle || null,
        isEliteReview: data.isEliteReview || false,
        isEdited: data.isEdited || false,
        isLikedByCurrentUser,
        replies: [],
        type: 'review'
      };
    }),
  );
  res.status(200).json(feed);
});

exports.getFollowingFeed = catchAsync(async (req, res, next) => {
  const { uid } = req.user;
  const page = parseInt(req.query.page) || 1;
  const limit = 20;
  const offset = (page - 1) * limit;
  
  const followingSnap = await db
    .collection("users")
    .doc(uid)
    .collection("following")
    .get();

  if (followingSnap.empty) return res.status(200).json([]);

  const followingIds = followingSnap.docs
    .map((doc) => doc.id)
    .filter((id) => id !== uid);

  if (followingIds.length === 0) return res.status(200).json([]);

  const activeIds = followingIds.slice(0, 30);

  const [reviewsSnapshot, listsSnapshot] = await Promise.all([
    db.collection("reviews")
      .where("userId", "in", activeIds)
      .limit(100) 
      .get(),
    db.collection("shared_lists")
      .where("userId", "in", activeIds)
      .limit(100)
      .get()
  ]);

  const reviews = await Promise.all(
    reviewsSnapshot.docs.map(async (d) => {
      const data = d.data();
      let isLikedByCurrentUser = false;
      
      if (uid) {
        const likeSnap = await db
          .collection("reviews")
          .doc(d.id)
          .collection("likes")
          .doc(uid)
          .get();
        isLikedByCurrentUser = likeSnap.exists;
      }

      return {
        id: d.id,
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
        username: data.username || 'Usuário',
        userPhoto: data.userPhoto || null,
        levelTitle: data.levelTitle || null,
        isEliteReview: data.isEliteReview || false,
        isEdited: data.isEdited || false,
        isLikedByCurrentUser,
        replies: [],
        type: 'review'
      };
    })
  );

  const sharedLists = await Promise.all(
    listsSnapshot.docs.map(async (doc) => {
      const data = doc.data();
      let listItems = [];
      let listCount = 0;
      let currentListName = data.listName;

      try {
        const listDoc = await db
          .collection("users")
          .doc(data.userId)
          .collection("lists")
          .doc(data.listId)
          .get();
        
        if (listDoc.exists) {
          const listData = listDoc.data();
          currentListName = listData.name;
          listCount = listData.items?.length || 0;
          listItems = listData.items?.slice(0, 4) || [];
        }
      } catch (e) {}

      return {
        id: doc.id,
        username: data.username || "Usuário",
        userPhoto: data.userPhoto || null,
        listName: currentListName,
        listCount,
        listItems,
        attachmentId: data.listId,
        createdAt: data.createdAt,
        type: 'list_share',
        content: data.content,
        likesCount: data.likesCount || 0
      };
    })
  );

  const feed = [...reviews, ...sharedLists];

  feed.sort(
    (a, b) =>
      (b.createdAt?.toDate?.() || new Date(b.createdAt)) -
      (a.createdAt?.toDate?.() || new Date(a.createdAt))
  );

  const paginatedFeed = feed.slice(offset, offset + limit);

  res.status(200).json(paginatedFeed);
});

exports.getSharedListsFeed = catchAsync(async (req, res, next) => {
  const page = parseInt(req.query.page) || 1;
  const limit = 20;
  const offset = (page - 1) * limit;

  const snapshot = await db
    .collection("shared_lists")
    .limit(100)
    .get();

  const allLists = await Promise.all(
    snapshot.docs.map(async (doc) => {
      const data = doc.data();
      let listItems = [];
      let listCount = 0;
      let currentListName = data.listName;
      try {
        const listDoc = await db
          .collection("users")
          .doc(data.userId)
          .collection("lists")
          .doc(data.listId)
          .get();
        if (listDoc.exists) {
          const listData = listDoc.data();
          currentListName = listData.name;
          listCount = listData.items?.length || 0;
          listItems = listData.items?.slice(0, 4) || [];
        }
      } catch (e) {}
      return {
        id: doc.id,
        username: data.username || "Usuário",
        userPhoto: data.userPhoto || null,
        listName: currentListName,
        listCount,
        listItems,
        attachmentId: data.listId,
        createdAt: data.createdAt,
        type: 'list_share',
        content: data.content,
        likesCount: data.likesCount || 0
      };
    }),
  );

  allLists.sort(
    (a, b) =>
      (b.createdAt?.toDate?.() || new Date(b.createdAt)) -
      (a.createdAt?.toDate?.() || new Date(a.createdAt))
  );

  const paginatedFeed = allLists.slice(offset, offset + limit);
  res.status(200).json(paginatedFeed);
});