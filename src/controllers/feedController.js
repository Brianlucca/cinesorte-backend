const { db } = require("../config/firebase");
const catchAsync = require("../utils/catchAsync");

exports.getGlobalFeed = catchAsync(async (req, res, next) => {
  const { uid } = req.user || {};
  const page = parseInt(req.query.page) || 1;
  const limit = 20;

  let query = db.collection("reviews")
    .orderBy("createdAt", "desc")
    .limit(limit);

  if (page > 1) {
    const offset = (page - 1) * limit;
    const countSnap = await db.collection("reviews")
      .orderBy("createdAt", "desc")
      .limit(offset)
      .get();
    if (!countSnap.empty) {
      const lastDoc = countSnap.docs[countSnap.docs.length - 1];
      query = db.collection("reviews")
        .orderBy("createdAt", "desc")
        .startAfter(lastDoc)
        .limit(limit);
    }
  }

  const snapshot = await query.get();

  let likedIds = new Set();
  if (uid && !snapshot.empty) {
    const reviewIds = snapshot.docs.map(d => d.id);
    const likeChecks = await Promise.all(
      reviewIds.map(id =>
        db.collection("reviews").doc(id).collection("likes").doc(uid).get()
      )
    );
    likeChecks.forEach((snap, i) => {
      if (snap.exists) likedIds.add(reviewIds[i]);
    });
  }

  const feed = snapshot.docs.map((doc) => {
    const data = doc.data();
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
      isLikedByCurrentUser: likedIds.has(doc.id),
      replies: [],
      type: 'review'
    };
  });

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
      .orderBy("createdAt", "desc")
      .limit(50)
      .get(),
    db.collection("shared_lists")
      .where("userId", "in", activeIds)
      .orderBy("createdAt", "desc")
      .limit(50)
      .get()
  ]);

  const reviewIds = reviewsSnapshot.docs.map(d => d.id);
  let likedIds = new Set();
  if (reviewIds.length > 0) {
    const likeChecks = await Promise.all(
      reviewIds.map(id =>
        db.collection("reviews").doc(id).collection("likes").doc(uid).get()
      )
    );
    likeChecks.forEach((snap, i) => {
      if (snap.exists) likedIds.add(reviewIds[i]);
    });
  }

  const reviews = reviewsSnapshot.docs.map((d) => {
    const data = d.data();
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
      isLikedByCurrentUser: likedIds.has(d.id),
      replies: [],
      type: 'review'
    };
  });

  const listIds = listsSnapshot.docs.map(d => ({ docId: d.id, data: d.data() }));
  const listDetailRefs = listIds.map(({ data }) =>
    db.collection("users").doc(data.userId).collection("lists").doc(data.listId).get()
  );
  const listDetails = await Promise.all(listDetailRefs.map(p => p.catch(() => null)));

  const sharedLists = listsSnapshot.docs.map((doc, i) => {
    const data = doc.data();
    const listDoc = listDetails[i];
    let listItems = [];
    let listCount = 0;
    let currentListName = data.listName;

    if (listDoc && listDoc.exists) {
      const listData = listDoc.data();
      currentListName = listData.name;
      listCount = listData.items?.length || 0;
      listItems = listData.items?.slice(0, 4) || [];
    }

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
  });

  const feed = [...reviews, ...sharedLists];
  feed.sort(
    (a, b) =>
      (b.createdAt?.toDate?.() || new Date(b.createdAt)) -
      (a.createdAt?.toDate?.() || new Date(a.createdAt))
  );

  res.status(200).json(feed.slice(offset, offset + limit));
});

exports.getSharedListsFeed = catchAsync(async (req, res, next) => {
  const page = parseInt(req.query.page) || 1;
  const limit = 20;
  const offset = (page - 1) * limit;

  const snapshot = await db
    .collection("shared_lists")
    .orderBy("createdAt", "desc")
    .limit(100)
    .get();

  const listDetailRefs = snapshot.docs.map(doc => {
    const data = doc.data();
    return db.collection("users").doc(data.userId).collection("lists").doc(data.listId).get();
  });
  const listDetails = await Promise.all(listDetailRefs.map(p => p.catch(() => null)));

  const allLists = snapshot.docs.map((doc, i) => {
    const data = doc.data();
    const listDoc = listDetails[i];
    let listItems = [];
    let listCount = 0;
    let currentListName = data.listName;

    if (listDoc && listDoc.exists) {
      const listData = listDoc.data();
      currentListName = listData.name;
      listCount = listData.items?.length || 0;
      listItems = listData.items?.slice(0, 4) || [];
    }

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
  });

  allLists.sort(
    (a, b) =>
      (b.createdAt?.toDate?.() || new Date(b.createdAt)) -
      (a.createdAt?.toDate?.() || new Date(a.createdAt))
  );

  res.status(200).json(allLists.slice(offset, offset + limit));
});