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

exports.addReview = catchAsync(async (req, res, next) => {
  const { uid } = req.user;
  const {
    mediaId,
    mediaType,
    rating,
    text,
    mediaTitle,
    posterPath,
    backdropPath,
    isEliteReview
  } = req.body;

  if (containsProfanity(text))
    return next(new AppError("Conteúdo impróprio.", 400));

  const userRef = db.collection("users").doc(uid);
  let levelUpInfo = null;

  await db.runTransaction(async (t) => {
    const userDoc = await t.get(userRef);
    const userData = userDoc.data();
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

    const updates = {
      reviewsCount: admin.firestore.FieldValue.increment(1),
      xp: currentXp,
      totalXp,
      level,
      levelTitle: calculateLevelTitle(reviewsCount),
    };

    if (finalTrophies.length > 0) {
      updates.trophies = admin.firestore.FieldValue.arrayUnion(...finalTrophies);
    }

    const reviewRef = db.collection("reviews").doc();
    const isElite = isEliteReview === true || isEliteReview === "true";

    const reviewPayload = {
      userId: uid,
      mediaId: mediaId.toString(),
      mediaType,
      mediaTitle: mediaTitle || "Título Desconhecido",
      posterPath: posterPath || "",
      backdropPath: backdropPath || "",
      rating,
      text: text || "",
      likesCount: 0,
      commentsCount: 0,
      createdAt: new Date(),
      username: userData.username,
      userPhoto: userData.photoURL,
      levelTitle: updates.levelTitle,
      isEliteReview: isElite,
      isEdited: false
    };

    t.set(reviewRef, reviewPayload);
    t.update(userRef, updates);

    if (level > initialLevel) levelUpInfo = { level, title: updates.levelTitle };

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
    userId: uid
  });

  batch.update(reviewRef, {
    text,
    rating,
    isEdited: true,
    updatedAt: new Date()
  });

  await batch.commit();
  res.status(200).json({ message: "Review atualizada." });
});

exports.deleteReview = catchAsync(async (req, res, next) => {
  const { uid } = req.user;
  const { reviewId } = req.params;

  const reviewRef = db.collection("reviews").doc(reviewId);
  const doc = await reviewRef.get();
  if (!doc.exists) return next(new AppError("Não encontrada.", 404));
  if (doc.data().userId !== uid) return next(new AppError("Sem permissão.", 403));

  const batch = db.batch();
  batch.delete(reviewRef);

  const historySnapshot = await reviewRef.collection("history").get();
  historySnapshot.forEach(doc => batch.delete(doc.ref));

  const commentsSnapshot = await db
    .collection("comments")
    .where("reviewId", "==", reviewId)
    .get();
  commentsSnapshot.forEach((doc) => batch.delete(doc.ref));

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
      t.update(reviewRef, {
        likesCount: currentLikes > 0 ? currentLikes - 1 : 0,
      });
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
    db.collection("reviews").doc(reviewId).get()
  ]);

  if (!reviewDoc.exists) return next(new AppError("Review não encontrada.", 404));

  const userData = userDoc.data() || {};
  const reviewData = reviewDoc.data();

  const commentData = {
    reviewId,
    userId: uid,
    username: userData.username || "Usuário",
    userPhoto: userData.photoURL || null,
    text,
    parentId: parentId || null,
    createdAt: new Date(),
    levelTitle: userData.levelTitle || "Espectador",
    isEdited: false
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
      senderName: userData.username || "Usuário",
      senderUsername: username || null,
      senderPhoto: userData.photoURL || null,
      type: "new_content",
      title: "Novo Comentário",
      message: `${userData.username || "Alguém"} comentou na sua review: "${text.substring(0, 30)}${text.length > 30 ? "..." : ""}"`,
      mediaId: reviewData.mediaId,
      mediaType: reviewData.mediaType,
      read: false,
      createdAt: new Date(),
      icon: "MessageCircle",
    });
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
    isEdited: commentData.isEdited
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
  batch.set(historyRef, {
    previousText: oldData.text,
    changedAt: new Date(),
    userId: uid
  });

  batch.update(commentRef, {
    text,
    isEdited: true,
    updatedAt: new Date()
  });

  await batch.commit();
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
  historySnapshot.forEach(hDoc => batch.delete(hDoc.ref));

  batch.delete(ref);
  batch.update(db.collection("reviews").doc(doc.data().reviewId), {
    commentsCount: admin.firestore.FieldValue.increment(-1),
  });
  await batch.commit();
  res.status(200).json({ message: "Deletado." });
});

exports.getMediaReviews = catchAsync(async (req, res, next) => {
  const { mediaId } = req.params;
  const { uid } = req.user;

  const snapshot = await db
    .collection("reviews")
    .where("mediaId", "==", mediaId)
    .orderBy("createdAt", "desc")
    .limit(50)
    .get();

  const reviewIds = snapshot.docs.map(d => d.id);
  let likedIds = new Set();

  if (uid && reviewIds.length > 0) {
    const likeChecks = await Promise.all(
      reviewIds.map(id =>
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
      posterPath: data.posterPath,
      backdropPath: data.backdropPath,
      rating: data.rating,
      text: data.text,
      likesCount: data.likesCount,
      commentsCount: data.commentsCount,
      createdAt: data.createdAt,
      username: data.username,
      userPhoto: data.userPhoto,
      levelTitle: data.levelTitle,
      isEliteReview: data.isEliteReview,
      isEdited: data.isEdited,
      isLikedByCurrentUser: likedIds.has(doc.id),
      replies: []
    };
  });

  res.status(200).json(reviews);
});

exports.getUserReviews = catchAsync(async (req, res, next) => {
  const { username } = req.params;
  const { uid } = req.user || {};

  const userQuery = await db
    .collection("users")
    .where("username", "==", username)
    .limit(1)
    .get();

  if (userQuery.empty) return res.status(404).json([]);

  const targetUid = userQuery.docs[0].id;

  const [reviewsSnapshot, listsSnapshot] = await Promise.all([
    db.collection("reviews")
      .where("userId", "==", targetUid)
      .orderBy("createdAt", "desc")
      .limit(20)
      .get(),
    db.collection("shared_lists")
      .where("userId", "==", targetUid)
      .orderBy("createdAt", "desc")
      .limit(20)
      .get()
  ]);

  const reviewIds = reviewsSnapshot.docs.map(d => d.id);
  let likedIds = new Set();

  if (uid && reviewIds.length > 0) {
    const likeChecks = await Promise.all(
      reviewIds.map(id =>
        db.collection("reviews").doc(id).collection("likes").doc(uid).get()
      )
    );
    likeChecks.forEach((snap, i) => {
      if (snap.exists) likedIds.add(reviewIds[i]);
    });
  }

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
      username: data.username || 'Usuário',
      userPhoto: data.userPhoto || null,
      levelTitle: data.levelTitle || null,
      isEliteReview: data.isEliteReview || false,
      isEdited: data.isEdited || false,
      type: 'review',
      isLikedByCurrentUser: likedIds.has(doc.id),
      replies: [],
    };
  });

  const listDetailRefs = listsSnapshot.docs.map(doc => {
    const data = doc.data();
    return db.collection("users").doc(data.userId).collection("lists").doc(data.listId).get();
  });
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
      username: data.username || 'Usuário',
      userPhoto: data.userPhoto || null,
      content: data.content || null,
      likesCount: data.likesCount || 0,
      createdAt: data.createdAt,
      type: 'list_share',
      listName: currentListName,
      listCount,
      listItems,
      attachmentId: data.listId,
    };
  });

  const feed = [...reviews, ...sharedLists];
  feed.sort(
    (a, b) =>
      (b.createdAt?.toDate?.() || new Date(b.createdAt)) -
      (a.createdAt?.toDate?.() || new Date(a.createdAt))
  );

  res.status(200).json(feed);
});

exports.getComments = catchAsync(async (req, res, next) => {
  const { reviewId } = req.params;
  const snapshot = await db
    .collection("comments")
    .where("reviewId", "==", reviewId)
    .orderBy("createdAt", "asc")
    .limit(100)
    .get();

  const comments = snapshot.docs.map((d) => {
    const data = d.data();
    return {
      id: d.id,
      reviewId: data.reviewId,
      username: data.username || 'Usuário',
      userPhoto: data.userPhoto || null,
      text: data.text,
      parentId: data.parentId || null,
      createdAt: data.createdAt,
      levelTitle: data.levelTitle || null,
      isEdited: data.isEdited || false,
    };
  });

  res.status(200).json(comments);
});