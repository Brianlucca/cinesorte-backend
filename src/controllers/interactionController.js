const { db } = require("../config/firebase");
const admin = require("firebase-admin");
const tmdbApi = require("../api/tmdb");
const { getXPNeeded, checkTrophies } = require("../utils/gamification");
const catchAsync = require("../utils/catchAsync");
const AppError = require("../utils/AppError");

exports.recordInteraction = catchAsync(async (req, res, next) => {
  const { uid } = req.user;
  const { mediaId, mediaType, action, mediaTitle, posterPath } = req.body;

  if (
    !mediaId ||
    !["like", "dislike", "watched", "favorite"].includes(action)
  ) {
    return next(new AppError("Dados inválidos.", 400));
  }

  const docId = `${uid}_${mediaId}`;
  const interactionRef = db.collection("interactions").doc(docId);
  const userRef = db.collection("users").doc(uid);
  let levelUpInfo = null;

  await db.runTransaction(async (t) => {
    const doc = await t.get(interactionRef);
    const userDoc = await t.get(userRef);
    const userData = userDoc.data();

    let data = doc.exists
      ? doc.data()
      : { userId: uid, mediaId: mediaId.toString(), mediaType };
    data.userId = uid;

    if (mediaTitle) data.mediaTitle = mediaTitle;
    if (posterPath) data.posterPath = posterPath;

    let genreWeight = 0;
    let xpEarned = 0;
    let watchedInc = 0;

    if (action === "like") {
      const wasLiked = data.liked;
      data.liked = !data.liked;
      data.disliked = false;
      genreWeight = data.liked ? 3 : -3;
      if (!wasLiked && data.liked) xpEarned = 5;
    } else if (action === "watched") {
      const wasWatched = data.watched;
      data.watched = !data.watched;
      if (data.watched) {
        data.watchedAt = new Date();
        if (!wasWatched) {
          xpEarned = 10;
          watchedInc = 1;
        }
      } else {
        watchedInc = -1;
      }
      genreWeight = data.watched ? 1 : 0;
    }

    data.lastInteraction = new Date();
    t.set(interactionRef, data, { merge: true });

    const userUpdates = {};
    let newLevel = userData.level || 1;
    const initialLevel = newLevel;

    if (xpEarned > 0) {
      let currentXp = (userData.xp || 0) + xpEarned;
      let totalXp = (userData.totalXp || 0) + xpEarned;
      while (currentXp >= getXPNeeded(newLevel)) {
        currentXp -= getXPNeeded(newLevel);
        newLevel++;
      }
      userUpdates.xp = currentXp;
      userUpdates.totalXp = totalXp;
      userUpdates.level = newLevel;
      const xpTrophies = checkTrophies(userData, "totalXp", totalXp);
      if (xpTrophies.length > 0) {
        userUpdates.trophies = admin.firestore.FieldValue.arrayUnion(
          ...xpTrophies,
        );
      }
    }

    if (watchedInc !== 0) {
      userUpdates.watchedCount =
        admin.firestore.FieldValue.increment(watchedInc);
      const watTrophies = checkTrophies(
        userData,
        "watched",
        (userData.watchedCount || 0) + watchedInc,
      );
      if (watTrophies.length > 0) {
        userUpdates.trophies = admin.firestore.FieldValue.arrayUnion(
          ...watTrophies,
        );
      }
    }

    if (genreWeight !== 0) {
      try {
        const tmdbRes = await tmdbApi.get(`/${mediaType}/${mediaId}`);
        const genres = tmdbRes.data.genres || [];
        genres.forEach((g) => {
          userUpdates[`genreCounts.${g.id}`] =
            admin.firestore.FieldValue.increment(genreWeight);
        });
      } catch (e) {}
    }

    if (newLevel > initialLevel) levelUpInfo = newLevel;
    if (Object.keys(userUpdates).length > 0) t.update(userRef, userUpdates);
  });

  if (levelUpInfo) {
    await db.collection("notifications").add({
      recipientId: uid,
      type: "level_up",
      title: "Level Up!",
      message: `Parabéns! Você alcançou o nível ${levelUpInfo}.`,
      read: false,
      createdAt: new Date(),
      icon: "TrendingUp",
    });
  }
  res.status(200).json({ message: "Sucesso." });
});

exports.getUserInteractions = catchAsync(async (req, res, next) => {
  const { uid } = req.user;
  const snapshot = await db
    .collection("interactions")
    .where("userId", "==", uid)
    .get();
  res.status(200).json(snapshot.docs.map((doc) => doc.data()));
});

exports.getWatchDiary = catchAsync(async (req, res, next) => {
  const { uid } = req.user;
  const { year } = req.query;
  const targetYear = parseInt(year) || new Date().getFullYear();

  const start = new Date(`${targetYear}-01-01`);
  const end = new Date(`${targetYear}-12-31T23:59:59`);

  const snapshot = await db
    .collection("interactions")
    .where("userId", "==", uid)
    .where("watched", "==", true)
    .where("watchedAt", ">=", start)
    .where("watchedAt", "<=", end)
    .orderBy("watchedAt", "desc")
    .get();

  const diary = {};
  snapshot.docs.forEach((doc) => {
    const data = doc.data();
    const month = data.watchedAt.toDate().getMonth();
    if (!diary[month]) diary[month] = [];
    diary[month].push(data);
  });

  res.status(200).json(diary);
});
