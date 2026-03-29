const { db } = require("../config/firebase");
const admin = require("firebase-admin");
const tmdbApi = require("../api/tmdb");
const { containsProfanity } = require("../utils/profanity");
const {
  getXPNeeded,
  checkTrophies,
  calculateLevelTitle,
} = require("../utils/gamification");
const catchAsync = require("../utils/catchAsync");
const AppError = require("../utils/AppError");

const MAX_MENTIONS_PER_TEXT = 5;

const safeUsername = (val) => (val && val.trim()) ? val.trim() : null;

const extractMentions = (text) => {
  if (!text) return [];
  const all = text.match(/@([a-z0-9_]+)/gi) || [];
  return all.slice(0, MAX_MENTIONS_PER_TEXT);
};

const getNewMentions = (oldText, newText) => {
  const oldM = extractMentions(oldText).map((m) => m.toLowerCase());
  const newM = extractMentions(newText);
  const oldSet = new Set(oldM);
  return newM.filter((m) => !oldSet.has(m.toLowerCase()));
};

const notifyMentions = async (mentionsArray, senderId, senderName, senderUsername, senderPhoto, mediaId, mediaType, reviewId) => {
  if (!mentionsArray || mentionsArray.length === 0) return;
  const uniqueUsernames = [...new Set(mentionsArray.map((m) => m.replace('@', '')))].slice(0, MAX_MENTIONS_PER_TEXT);

  for (const username of uniqueUsernames) {
    if (username === senderUsername) continue;
    try {
      const userQuery = await db.collection("users").where("username", "==", username).limit(1).get();
      if (!userQuery.empty) {
        const targetUserId = userQuery.docs[0].id;
        await db.collection("notifications").add({
          recipientId: targetUserId,
          senderId: senderId,
          senderName: senderName || "Usuário",
          senderUsername: senderUsername || null,
          senderPhoto: senderPhoto || null,
          type: "mention",
          title: "Você foi mencionado!",
          message: `@${senderUsername || senderName || "alguém"} mencionou você.`,
          mediaId: mediaId,
          mediaType: mediaType,
          reviewId: reviewId || null,
          read: false,
          createdAt: new Date(),
          icon: "AtSign",
        });
      }
    } catch (e) {}
  }
};

const ELITE_TITLES = [
  "Mestre da Crítica",
  "Oráculo da Sétima Arte",
  "Entidade Cinematográfica",
  "Divindade do Cinema",
];

exports.addReview = catchAsync(async (req, res, next) => {
  const { uid } = req.user;
  const {
    mediaId, mediaType, rating, text,
    mediaTitle, posterPath, backdropPath,
  } = req.body;

  if (text && containsProfanity(text))
    return next(new AppError("Conteúdo impróprio.", 400));

  const userRef = db.collection("users").doc(uid);
  let levelUpInfo = null;
  let userDataCache = null;
  let newReviewId = null;

  await db.runTransaction(async (t) => {
    const userDoc = await t.get(userRef);
    const userData = userDoc.data();
    userDataCache = userData;
    const xpEarned = 20;
    let currentXp = (userData.xp || 0) + xpEarned;
    let totalXp = (userData.totalXp || 0) + xpEarned;
    let level = userData.level || 1;
    const initialLevel = level;
    const reviewsCount = (userData.reviewsCount || 0) + 1;

    while (currentXp >= getXPNeeded(level)) {
      currentXp -= getXPNeeded(level);
      level++;
    }

    const trophiesToAdd = checkTrophies(userData, "reviews", reviewsCount);
    const xpTrophies = checkTrophies(userData, "totalXp", totalXp);
    const finalTrophies = [...trophiesToAdd, ...xpTrophies];

    const newLevelTitle = calculateLevelTitle(reviewsCount);

    const updates = {
      reviewsCount: admin.firestore.FieldValue.increment(1),
      xp: currentXp,
      totalXp,
      level,
      levelTitle: newLevelTitle,
    };

    if (finalTrophies.length > 0) {
      updates.trophies = admin.firestore.FieldValue.arrayUnion(...finalTrophies);
    }

    const isElite = ELITE_TITLES.includes(newLevelTitle);

    const reviewRef = db.collection("reviews").doc();
    newReviewId = reviewRef.id;

    const reviewPayload = {
      userId: uid,
      mediaId: mediaId.toString(),
      mediaType,
      mediaTitle: mediaTitle || "Título Desconhecido",
      posterPath: posterPath || "",
      backdropPath: backdropPath || "",
      rating: rating !== undefined ? rating : null,
      text: text || "",
      likesCount: 0,
      commentsCount: 0,
      createdAt: new Date(),
      username: safeUsername(userData.username) || null,
      userPhoto: userData.photoURL || null,
      levelTitle: newLevelTitle,
      isEliteReview: isElite,
      isEdited: false,
    };

    t.set(reviewRef, reviewPayload);
    t.update(userRef, updates);

    if (level > initialLevel) levelUpInfo = { level, title: newLevelTitle };

    if (mediaType !== "person") {
      try {
        const cleanId = mediaId.toString().replace(/^(movie-|tv-)/, "");
        const tmdbRes = await tmdbApi.get(`/${mediaType}/${cleanId}`);
        const genres = tmdbRes.data.genres || [];
        genres.forEach((g) => {
          t.update(userRef, {
            [`genreCounts.${g.id}`]: admin.firestore.FieldValue.increment(2),
          });
        });
      } catch (e) {}
    }
  });

  if (levelUpInfo) {
    await db.collection("notifications").add({
      recipientId: uid,
      type: "level_up",
      title: "Novo Nível!",
      message: `Você alcançou o nível ${levelUpInfo.level} - ${levelUpInfo.title}!`,
      read: false,
      createdAt: new Date(),
      icon: "TrendingUp",
    });
  }

  const mentions = extractMentions(text);
  if (mentions.length > 0 && userDataCache) {
    await notifyMentions(
      mentions,
      uid,
      userDataCache.name,
      userDataCache.username,
      userDataCache.photoURL,
      mediaId,
      mediaType,
      newReviewId
    );
  }

  res.status(201).json({ message: "Review salva." });
});

exports.updateReview = catchAsync(async (req, res, next) => {
  const { uid } = req.user;
  const { reviewId } = req.params;
  const { text, rating } = req.body;

  if (text && containsProfanity(text))
    return next(new AppError("Conteúdo impróprio.", 400));

  const reviewRef = db.collection("reviews").doc(reviewId);
  const doc = await reviewRef.get();

  if (!doc.exists) return next(new AppError("Review não encontrada.", 404));
  if (doc.data().userId !== uid) return next(new AppError("Sem permissão.", 403));

  const oldData = doc.data();
  const batch = db.batch();

  const historyRef = reviewRef.collection("history").doc();
  batch.set(historyRef, {
    previousText: oldData.text,
    previousRating: oldData.rating,
    changedAt: new Date(),
    userId: uid,
  });

  batch.update(reviewRef, {
    text,
    rating: rating !== undefined ? rating : null,
    isEdited: true,
    updatedAt: new Date(),
  });

  await batch.commit();

  const newMentions = getNewMentions(oldData.text, text);
  if (newMentions.length > 0) {
    const userDoc = await db.collection("users").doc(uid).get();
    const userData = userDoc.data();
    await notifyMentions(
      newMentions,
      uid,
      userData.name,
      userData.username,
      userData.photoURL,
      oldData.mediaId,
      oldData.mediaType,
      reviewId
    );
  }

  res.status(200).json({ message: "Review atualizada." });
});

exports.deleteReview = catchAsync(async (req, res, next) => {
  const { uid } = req.user;
  const { reviewId } = req.params;

  const reviewRef = db.collection("reviews").doc(reviewId);
  const doc = await reviewRef.get();
  if (!doc.exists) return next(new AppError("Não encontrada.", 404));
  if (doc.data().userId !== uid) return next(new AppError("Sem permissão.", 403));

  const userRef = db.collection("users").doc(uid);

  await db.runTransaction(async (t) => {
    const userDoc = await t.get(userRef);
    const userData = userDoc.data();

    const newTotalXp = Math.max(0, (userData.totalXp || 0) - 20);
    const newReviewsCount = Math.max(0, (userData.reviewsCount || 0) - 1);
    const newLevelTitle = calculateLevelTitle(newReviewsCount);

    let xpPool = newTotalXp;
    let newLevel = 1;
    while (xpPool >= getXPNeeded(newLevel)) {
      xpPool -= getXPNeeded(newLevel);
      newLevel++;
    }

    t.update(userRef, {
      reviewsCount: newReviewsCount,
      totalXp: newTotalXp,
      xp: xpPool,
      level: newLevel,
      levelTitle: newLevelTitle,
    });
  });

  const batch = db.batch();
  batch.delete(reviewRef);

  const historySnapshot = await reviewRef.collection("history").get();
  historySnapshot.forEach((d) => batch.delete(d.ref));

  const commentsSnapshot = await db
    .collection("comments")
    .where("reviewId", "==", reviewId)
    .get();
  commentsSnapshot.forEach((d) => batch.delete(d.ref));

  await batch.commit();
  res.status(200).json({ message: "Review deletada." });
});

exports.toggleLikeReview = catchAsync(async (req, res, next) => {
  const { uid, name, photoURL, username } = req.user;
  const { reviewId } = req.params;
  let notificationData = null;

  await db.runTransaction(async (t) => {
    const reviewRef = db.collection("reviews").doc(reviewId);
    const likeRef = reviewRef.collection("likes").doc(uid);
    const doc = await t.get(likeRef);
    const reviewDoc = await t.get(reviewRef);
    if (!reviewDoc.exists) throw new Error("Review não encontrada");

    const reviewData = reviewDoc.data();
    const currentLikes = reviewData.likesCount || 0;

    if (doc.exists) {
      t.delete(likeRef);
      t.update(reviewRef, { likesCount: currentLikes > 0 ? currentLikes - 1 : 0 });
    } else {
      t.set(likeRef, {
        userId: uid,
        name: name || "Usuário",
        photoURL: photoURL || null,
        createdAt: new Date(),
      });
      t.update(reviewRef, { likesCount: currentLikes + 1 });
      if (reviewData.userId !== uid) {
        notificationData = {
          recipientId: reviewData.userId,
          senderId: uid,
          senderName: username || "Usuário",
          senderUsername: username || null,
          senderPhoto: photoURL || null,
          type: "new_content",
          title: "Nova Curtida",
          message: `${username || "Alguém"} curtiu sua review de ${reviewData.mediaTitle}.`,
          mediaId: reviewData.mediaId,
          mediaType: reviewData.mediaType,
          read: false,
          createdAt: new Date(),
          icon: "Heart",
        };
      }
    }
  });

  if (notificationData) await db.collection("notifications").add(notificationData);
  res.status(200).json({ message: "Sucesso" });
});

exports.addComment = catchAsync(async (req, res, next) => {
  const { uid, username } = req.user;
  const { reviewId, text, parentId } = req.body;
  if (containsProfanity(text))
    return next(new AppError("Conteúdo impróprio.", 400));

  const [userDoc, reviewDoc] = await Promise.all([
    db.collection("users").doc(uid).get(),
    db.collection("reviews").doc(reviewId).get(),
  ]);

  if (!reviewDoc.exists) return next(new AppError("Review não encontrada.", 404));

  const userData = userDoc.data() || {};
  const reviewData = reviewDoc.data();

  const commentData = {
    reviewId,
    userId: uid,
    username: safeUsername(userData.username) || "Usuário",
    userPhoto: userData.photoURL || null,
    text,
    parentId: parentId || null,
    createdAt: new Date(),
    levelTitle: userData.levelTitle || "Espectador",
    isEdited: false,
  };

  const batch = db.batch();
  const commentRef = db.collection("comments").doc();
  batch.set(commentRef, commentData);
  batch.update(db.collection("reviews").doc(reviewId), {
    commentsCount: admin.firestore.FieldValue.increment(1),
  });
  await batch.commit();

  if (reviewData.userId !== uid) {
    await db.collection("notifications").add({
      recipientId: reviewData.userId,
      senderId: uid,
      senderName: safeUsername(userData.username) || "Usuário",
      senderUsername: username || null,
      senderPhoto: userData.photoURL || null,
      type: "new_content",
      title: "Novo Comentário",
      message: `${safeUsername(userData.username) || "Alguém"} comentou na sua review: "${text.substring(0, 30)}${text.length > 30 ? "..." : ""}"`,
      mediaId: reviewData.mediaId,
      mediaType: reviewData.mediaType,
      read: false,
      createdAt: new Date(),
      icon: "MessageCircle",
    });
  }

  const mentions = extractMentions(text);
  if (mentions.length > 0) {
    await notifyMentions(
      mentions,
      uid,
      userData.name,
      userData.username,
      userData.photoURL,
      reviewData.mediaId,
      reviewData.mediaType,
      reviewId
    );
  }

  res.status(201).json({
    id: commentRef.id,
    reviewId: commentData.reviewId,
    username: commentData.username,
    userPhoto: commentData.userPhoto,
    text: commentData.text,
    parentId: commentData.parentId,
    createdAt: commentData.createdAt,
    levelTitle: commentData.levelTitle,
    isEdited: commentData.isEdited,
  });
});

exports.updateComment = catchAsync(async (req, res, next) => {
  const { uid } = req.user;
  const { commentId } = req.params;
  const { text } = req.body;

  if (text && containsProfanity(text))
    return next(new AppError("Conteúdo impróprio.", 400));

  const commentRef = db.collection("comments").doc(commentId);
  const doc = await commentRef.get();

  if (!doc.exists) return next(new AppError("Comentário não encontrado.", 404));
  if (doc.data().userId !== uid) return next(new AppError("Sem permissão.", 403));

  const oldData = doc.data();
  const batch = db.batch();

  const historyRef = commentRef.collection("history").doc();
  batch.set(historyRef, { previousText: oldData.text, changedAt: new Date(), userId: uid });

  batch.update(commentRef, { text, isEdited: true, updatedAt: new Date() });

  await batch.commit();

  const newMentions = getNewMentions(oldData.text, text);
  if (newMentions.length > 0) {
    const userDoc = await db.collection("users").doc(uid).get();
    const userData = userDoc.data();
    const reviewDoc = await db.collection("reviews").doc(oldData.reviewId).get();
    const reviewData = reviewDoc.data();
    await notifyMentions(
      newMentions,
      uid,
      userData.name,
      userData.username,
      userData.photoURL,
      reviewData.mediaId,
      reviewData.mediaType,
      oldData.reviewId
    );
  }

  res.status(200).json({ message: "Comentário atualizado." });
});

exports.deleteComment = catchAsync(async (req, res, next) => {
  const { uid } = req.user;
  const { commentId } = req.params;

  const ref = db.collection("comments").doc(commentId);
  const doc = await ref.get();
  if (!doc.exists) return next(new AppError("Não encontrado.", 404));
  if (doc.data().userId !== uid) return next(new AppError("Proibido.", 403));

  const batch = db.batch();
  const historySnapshot = await ref.collection("history").get();
  historySnapshot.forEach((hDoc) => batch.delete(hDoc.ref));
  batch.delete(ref);
  batch.update(db.collection("reviews").doc(doc.data().reviewId), {
    commentsCount: admin.firestore.FieldValue.increment(-1),
  });
  await batch.commit();
  res.status(200).json({ message: "Deletado." });
});

async function resolveUsernamesFallback(docs, getDataFn) {
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
            const ud = userDoc.data();
            userCache[userId] = {
              username: safeUsername(ud.username) || null,
              userPhoto: ud.photoURL || null,
            };
          }
        } catch {}
      })
    );
  }
  return userCache;
}

exports.getMediaReviews = catchAsync(async (req, res, next) => {
  const { mediaId } = req.params;
  const { uid } = req.user;

  const snapshot = await db
    .collection("reviews")
    .where("mediaId", "==", mediaId)
    .orderBy("createdAt", "desc")
    .limit(50)
    .get();

  const reviewIds = snapshot.docs.map((d) => d.id);
  let likedIds = new Set();

  if (uid && reviewIds.length > 0) {
    const likeChecks = await Promise.all(
      reviewIds.map((id) =>
        db.collection("reviews").doc(id).collection("likes").doc(uid).get()
      )
    );
    likeChecks.forEach((snap, i) => {
      if (snap.exists) likedIds.add(reviewIds[i]);
    });
  }

  const userCache = await resolveUsernamesFallback(snapshot.docs, (d) => d.data());

  const reviews = snapshot.docs.map((doc) => {
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
    };
  });

  res.status(200).json(reviews);
});

exports.getUserReviews = catchAsync(async (req, res, next) => {
  const { username } = req.params;
  const { uid } = req.user || {};
  const { lastCreatedAt } = req.query;

  const userQuery = await db.collection("users").where("username", "==", username).limit(1).get();
  if (userQuery.empty) return res.status(404).json([]);

  const targetUid = userQuery.docs[0].id;
  const targetUser = userQuery.docs[0].data();

  let reviewsQuery = db
    .collection("reviews")
    .where("userId", "==", targetUid)
    .orderBy("createdAt", "desc")
    .limit(20);

  let listsQuery = db
    .collection("shared_lists")
    .where("userId", "==", targetUid)
    .orderBy("createdAt", "desc")
    .limit(20);

  if (lastCreatedAt) {
    const cursor = new Date(parseInt(lastCreatedAt));
    reviewsQuery = reviewsQuery.startAfter(cursor);
    listsQuery = listsQuery.startAfter(cursor);
  }

  const [reviewsSnapshot, listsSnapshot] = await Promise.all([
    reviewsQuery.get(),
    listsQuery.get(),
  ]);

  const reviewIds = reviewsSnapshot.docs.map((d) => d.id);
  let likedIds = new Set();

  if (uid && reviewIds.length > 0) {
    const likeChecks = await Promise.all(
      reviewIds.map((id) =>
        db.collection("reviews").doc(id).collection("likes").doc(uid).get()
      )
    );
    likeChecks.forEach((snap, i) => {
      if (snap.exists) likedIds.add(reviewIds[i]);
    });
  }

  const resolvedUsername = safeUsername(targetUser.username) || username;
  const resolvedPhoto = targetUser.photoURL || null;

  const reviews = reviewsSnapshot.docs.map((doc) => {
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
      username: safeUsername(data.username) || resolvedUsername,
      userPhoto: data.userPhoto || resolvedPhoto,
      levelTitle: data.levelTitle || null,
      isEliteReview: data.isEliteReview || false,
      isEdited: data.isEdited || false,
      type: "review",
      isLikedByCurrentUser: likedIds.has(doc.id),
      isOwner: uid ? data.userId === uid : false,
      replies: [],
    };
  });

  const listDetailRefs = listsSnapshot.docs.map((doc) => {
    const data = doc.data();
    return db.collection("users").doc(data.userId).collection("lists").doc(data.listId).get();
  });
  const listDetails = await Promise.all(listDetailRefs.map((p) => p.catch(() => null)));

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
      username: safeUsername(data.username) || resolvedUsername,
      userPhoto: data.userPhoto || resolvedPhoto,
      content: data.content || null,
      likesCount: data.likesCount || 0,
      createdAt: data.createdAt,
      type: "list_share",
      listName: currentListName,
      listCount,
      listItems,
      attachmentId: data.listId,
      isOwner: uid ? data.userId === uid : false,
    };
  });

  const feed = [...reviews, ...sharedLists];
  feed.sort(
    (a, b) =>
      (b.createdAt?.toDate?.() || new Date(b.createdAt)) -
      (a.createdAt?.toDate?.() || new Date(a.createdAt))
  );

  const hasMore = reviewsSnapshot.docs.length === 20 || listsSnapshot.docs.length === 20;
  const lastItem = feed[feed.length - 1];
  const nextCursor = lastItem?.createdAt
    ? (lastItem.createdAt?.toDate?.() || new Date(lastItem.createdAt)).getTime()
    : null;

  res.status(200).json({ items: feed, hasMore, nextCursor });
});

exports.getUserReviewsOnly = catchAsync(async (req, res, next) => {
  const { username } = req.params;
  const { uid } = req.user || {};
  const { lastCreatedAt } = req.query;

  const userQuery = await db.collection("users").where("username", "==", username).limit(1).get();
  if (userQuery.empty) return res.status(404).json({ items: [], hasMore: false, nextCursor: null });

  const targetUid = userQuery.docs[0].id;
  const targetUser = userQuery.docs[0].data();
  const resolvedUsername = safeUsername(targetUser.username) || username;
  const resolvedPhoto = targetUser.photoURL || null;

  let query = db
    .collection("reviews")
    .where("userId", "==", targetUid)
    .orderBy("createdAt", "desc")
    .limit(20);

  if (lastCreatedAt) {
    query = query.startAfter(new Date(parseInt(lastCreatedAt)));
  }

  const snapshot = await query.get();

  const reviewIds = snapshot.docs.map((d) => d.id);
  let likedIds = new Set();

  if (uid && reviewIds.length > 0) {
    const likeChecks = await Promise.all(
      reviewIds.map((id) =>
        db.collection("reviews").doc(id).collection("likes").doc(uid).get()
      )
    );
    likeChecks.forEach((snap, i) => {
      if (snap.exists) likedIds.add(reviewIds[i]);
    });
  }

  const reviews = snapshot.docs.map((doc) => {
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
      username: safeUsername(data.username) || resolvedUsername,
      userPhoto: data.userPhoto || resolvedPhoto,
      levelTitle: data.levelTitle || null,
      isEliteReview: data.isEliteReview || false,
      isEdited: data.isEdited || false,
      type: "review",
      isLikedByCurrentUser: likedIds.has(doc.id),
      isOwner: uid ? data.userId === uid : false,
      replies: [],
    };
  });

  const hasMore = snapshot.docs.length === 20;
  const lastItem = reviews[reviews.length - 1];
  const nextCursor = lastItem?.createdAt
    ? (lastItem.createdAt?.toDate?.() || new Date(lastItem.createdAt)).getTime()
    : null;

  res.status(200).json({ items: reviews, hasMore, nextCursor });
});

exports.getComments = catchAsync(async (req, res, next) => {
  const { reviewId } = req.params;
  const { uid } = req.user || {};

  const snapshot = await db
    .collection("comments")
    .where("reviewId", "==", reviewId)
    .orderBy("createdAt", "asc")
    .limit(100)
    .get();

  const userCache = await resolveUsernamesFallback(snapshot.docs, (d) => d.data());

  const comments = snapshot.docs.map((d) => {
    const data = d.data();
    const fallback = userCache[data.userId] || {};
    return {
      id: d.id,
      reviewId: data.reviewId,
      username: safeUsername(data.username) || safeUsername(fallback.username) || "Usuário",
      userPhoto: data.userPhoto || fallback.userPhoto || null,
      text: data.text,
      parentId: data.parentId || null,
      createdAt: data.createdAt,
      levelTitle: data.levelTitle || null,
      isEdited: data.isEdited || false,
      isOwner: uid ? data.userId === uid : false,
    };
  });

  res.status(200).json(comments);
});