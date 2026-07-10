const { db } = require("../../config/firebase");
const admin = require("firebase-admin");
const { getXPNeeded, checkTrophies } = require("../../shared/utils/gamification");

const hasValidRating = (rating) => {
  const value = Number(rating);
  return rating !== null && rating !== undefined && Number.isFinite(value) && value >= 1 && value <= 5;
};

async function markRatedReviewAsWatched(uid, reviewData) {
  if (!uid || !reviewData?.mediaId || !hasValidRating(reviewData.rating)) return false;

  const mediaId = String(reviewData.mediaId);
  const interactionRef = db.collection("interactions").doc(`${uid}_${mediaId}`);
  const userRef = db.collection("users").doc(uid);
  let created = false;

  await db.runTransaction(async (transaction) => {
    const [interactionDoc, userDoc] = await Promise.all([
      transaction.get(interactionRef),
      transaction.get(userRef),
    ]);
    if (!userDoc.exists) return;

    const interaction = interactionDoc.exists ? interactionDoc.data() : {};
    if (interaction.watched) return;

    const watchedAt = reviewData.createdAt || new Date();
    transaction.set(interactionRef, {
      userId: uid,
      mediaId,
      mediaType: reviewData.mediaType || interaction.mediaType || "movie",
      mediaTitle: reviewData.mediaTitle || interaction.mediaTitle || "",
      posterPath: reviewData.posterPath || interaction.posterPath || "",
      backdropPath: reviewData.backdropPath || interaction.backdropPath || "",
      watched: true,
      watchedAt,
      timestamp: interaction.timestamp || watchedAt,
      lastInteraction: new Date(),
    }, { merge: true });

    const userData = userDoc.data() || {};
    const nextWatchedCount = (userData.watchedCount || 0) + 1;
    const totalXp = (userData.totalXp || 0) + 10;
    let xp = (userData.xp || 0) + 10;
    let level = userData.level || 1;
    while (xp >= getXPNeeded(level)) {
      xp -= getXPNeeded(level);
      level += 1;
    }

    const updates = {
      watchedCount: admin.firestore.FieldValue.increment(1),
      totalXp,
      xp,
      level,
    };
    const trophies = [
      ...checkTrophies(userData, "watched", nextWatchedCount),
      ...checkTrophies(userData, "totalXp", totalXp),
    ];
    if (trophies.length > 0) {
      updates.trophies = admin.firestore.FieldValue.arrayUnion(...trophies);
    }
    transaction.update(userRef, updates);
    created = true;
  });

  return created;
}

module.exports = { hasValidRating, markRatedReviewAsWatched };
