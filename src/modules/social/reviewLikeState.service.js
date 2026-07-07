const { db } = require("../../config/firebase");

const MAX_IN_QUERY = 30;

function chunk(items, size) {
  const output = [];
  for (let i = 0; i < items.length; i += size) {
    output.push(items.slice(i, i + size));
  }
  return output;
}

function getIndexRef(uid, reviewId) {
  return db.collection("user_review_likes").doc(`${uid}_${reviewId}`);
}

async function backfillLikeIndex(uid, reviewIds) {
  if (!uid || !Array.isArray(reviewIds) || reviewIds.length === 0) return new Set();

  const refs = reviewIds.map((reviewId) =>
    db.collection("reviews").doc(reviewId).collection("likes").doc(uid)
  );
  const snapshots = await db.getAll(...refs);
  const likedIds = new Set();
  const batch = db.batch();
  let writes = 0;

  snapshots.forEach((snap, index) => {
    if (!snap.exists) return;
    const reviewId = reviewIds[index];
    likedIds.add(reviewId);
    batch.set(getIndexRef(uid, reviewId), {
      userId: uid,
      reviewId,
      createdAt: new Date(),
    }, { merge: true });
    writes += 1;
  });

  if (writes > 0) await batch.commit();
  return likedIds;
}

async function getLikedReviewIds(uid, reviewIds) {
  const likedIds = new Set();
  if (!uid || !Array.isArray(reviewIds) || reviewIds.length === 0) return likedIds;

  const missingIds = new Set(reviewIds);
  const chunks = chunk(reviewIds, MAX_IN_QUERY);

  for (const ids of chunks) {
    const snapshot = await db
      .collection("user_review_likes")
      .where("userId", "==", uid)
      .where("reviewId", "in", ids)
      .get();

    snapshot.docs.forEach((doc) => {
      const data = doc.data();
      if (data.reviewId) {
        likedIds.add(data.reviewId);
        missingIds.delete(data.reviewId);
      }
    });
  }

  if (missingIds.size > 0) {
    const recovered = await backfillLikeIndex(uid, [...missingIds]);
    recovered.forEach((id) => likedIds.add(id));
  }

  return likedIds;
}

async function setLikeState(uid, reviewId, liked) {
  const ref = getIndexRef(uid, reviewId);
  if (liked) {
    await ref.set({
      userId: uid,
      reviewId,
      createdAt: new Date(),
    }, { merge: true });
  } else {
    await ref.delete().catch(() => {});
  }
}

module.exports = {
  getLikedReviewIds,
  setLikeState,
};
