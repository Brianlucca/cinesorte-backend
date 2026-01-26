const { db } = require("../config/firebase");
const admin = require("firebase-admin");
const tmdbApi = require("../api/tmdb");

const getXPNeeded = (level) => {
  return 100 + (level - 1) * 50;
};

const checkTrophies = (userData, type, value) => {
  const newTrophies = [];
  const currentTrophyIds = new Set((userData.trophies || []).map((t) => t.id));
  const trophiesList = [
    {
      id: "wat_10",
      title: "Iniciando a Coleção",
      criteria: "watched",
      threshold: 10,
      icon: "Play",
    },
    {
      id: "wat_50",
      title: "Maratonista de Respeito",
      criteria: "watched",
      threshold: 50,
      icon: "Flame",
    },
    {
      id: "xp_5000",
      title: "Mestre do CineSorte",
      criteria: "totalXp",
      threshold: 5000,
      icon: "Star",
    },
  ];
  trophiesList.forEach((t) => {
    if (
      !currentTrophyIds.has(t.id) &&
      type === t.criteria &&
      value >= t.threshold
    ) {
      newTrophies.push({
        id: t.id,
        title: t.title,
        icon: t.icon,
        awardedAt: new Date(),
      });
    }
  });
  return newTrophies;
};

const recordInteraction = async (req, res) => {
  const { uid } = req.user;
  const { mediaId, mediaType, action, mediaTitle, posterPath } = req.body;
  if (
    !mediaId ||
    !["like", "dislike", "watched", "favorite"].includes(action)
  ) {
    return res.status(400).json({ message: "Dados inválidos." });
  }

  try {
    const docId = `${uid}_${mediaId}`;
    const interactionRef = db.collection("interactions").doc(docId);
    const userRef = db.collection("users").doc(uid);

    await db.runTransaction(async (t) => {
      const doc = await t.get(interactionRef);
      const userDoc = await t.get(userRef);
      const userData = userDoc.data();
      let data = doc.exists
        ? doc.data()
        : { userId: uid, mediaId: mediaId.toString(), mediaType };
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
      if (xpEarned > 0) {
        let currentXp = (userData.xp || 0) + xpEarned;
        let totalXp = (userData.totalXp || 0) + xpEarned;
        let level = userData.level || 1;
        while (currentXp >= getXPNeeded(level)) {
          currentXp -= getXPNeeded(level);
          level++;
        }
        userUpdates.xp = currentXp;
        userUpdates.totalXp = totalXp;
        userUpdates.level = level;
        const xpTrophies = checkTrophies(userData, "totalXp", totalXp);
        if (xpTrophies.length > 0)
          userUpdates.trophies = admin.firestore.FieldValue.arrayUnion(
            ...xpTrophies,
          );
      }

      if (watchedInc !== 0) {
        const newWatchedCount = (userData.watchedCount || 0) + watchedInc;
        userUpdates.watchedCount =
          admin.firestore.FieldValue.increment(watchedInc);
        const watTrophies = checkTrophies(userData, "watched", newWatchedCount);
        if (watTrophies.length > 0)
          userUpdates.trophies = admin.firestore.FieldValue.arrayUnion(
            ...watTrophies,
          );
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
      if (Object.keys(userUpdates).length > 0) t.update(userRef, userUpdates);
    });
    res.status(200).json({ message: "Sucesso." });
  } catch (error) {
    res.status(500).json({ message: "Erro." });
  }
};

const getUserInteractions = async (req, res) => {
  const { uid } = req.user;
  try {
    const snapshot = await db
      .collection("interactions")
      .where("userId", "==", uid)
      .get();
    res.status(200).json(snapshot.docs.map((doc) => doc.data()));
  } catch (error) {
    res.status(500).json({ message: "Erro." });
  }
};

const getWatchDiary = async (req, res) => {
  const { uid } = req.user;
  const { year } = req.query;
  const targetYear = parseInt(year) || new Date().getFullYear();
  try {
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
  } catch (error) {
    res.status(500).json({ message: "Erro." });
  }
};

module.exports = { recordInteraction, getUserInteractions, getWatchDiary };
