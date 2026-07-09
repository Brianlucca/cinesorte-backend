const admin = require("firebase-admin");

const { db } = require("../../config/firebase");
const { deleteByPrefix } = require("../../shared/cache/cache.service");
const AppError = require("../../shared/errors/AppError");
const catchAsync = require("../../shared/utils/catchAsync");
const { checkTrophies } = require("../../shared/utils/gamification");

async function getUidByUsername(username) {
  if (!username) throw new AppError("Usuário não especificado.", 400);
  const snapshot = await db.collection("users").where("username", "==", username).limit(1).get();
  if (snapshot.empty) throw new AppError("Usuário não encontrado.", 404);
  return snapshot.docs[0].id;
}

async function resolveUserId(handle, requesterUid = null) {
  if (!handle) throw new AppError("Usuário não especificado.", 400);

  const directDoc = await db.collection("users").doc(handle).get();
  if (directDoc.exists && handle === requesterUid) return handle;

  return getUidByUsername(handle);
}

function normalizeSocialListCursor(cursor) {
  if (!cursor) return null;
  const date = new Date(Number(cursor));
  return Number.isNaN(date.getTime()) ? null : date;
}

function serializePublicSocialUser(data = {}) {
  const username = data.username || null;

  return {
    id: username,
    publicId: username,
    profilePath: username ? `/app/profile/${username}` : null,
    name: data.name || null,
    username,
    userPhoto: data.photoURL || null,
    photoURL: data.photoURL || null,
    levelTitle: data.levelTitle || null,
  };
}

async function getUserSocialList({ userId, collectionName, paged, requesterUid }) {
  const targetUid = await resolveUserId(userId, requesterUid);
  const limit = Math.min(Number(paged?.limit) || 50, 50);
  let query = db
    .collection("users")
    .doc(targetUid)
    .collection(collectionName)
    .orderBy("since", "desc")
    .limit(limit);

  const cursorDate = normalizeSocialListCursor(paged?.cursor);
  if (cursorDate) query = query.startAfter(cursorDate);

  const snapshot = await query.get();
  if (snapshot.empty) {
    return paged ? { items: [], hasMore: false, nextCursor: null } : [];
  }

  const userRefs = snapshot.docs.map((doc) => db.collection("users").doc(doc.id));
  const usersDocs = await db.getAll(...userRefs);

  const items = usersDocs
    .filter((doc) => doc.exists)
    .map((doc) => serializePublicSocialUser(doc.data()));

  if (!paged) return items;

  const lastDoc = snapshot.docs[snapshot.docs.length - 1];
  const lastSince = lastDoc?.data()?.since;
  return {
    items,
    hasMore: snapshot.docs.length === limit,
    nextCursor: lastSince ? lastSince.toDate?.().getTime?.() || new Date(lastSince).getTime() : null,
  };
}

async function getLikedMediaIdsForUser(userId) {
  const userDoc = await db.collection("users").doc(userId).get();
  if (!userDoc.exists) return [];

  const userData = userDoc.data();
  if (Array.isArray(userData.likedMediaIds)) return userData.likedMediaIds;

  const likesSnapshot = await db
    .collection("interactions")
    .where("userId", "==", userId)
    .where("liked", "==", true)
    .limit(500)
    .get();

  const likedMediaIds = likesSnapshot.docs.map((doc) => doc.data().mediaId).filter(Boolean);

  if (likedMediaIds.length > 0) {
    await db.collection("users").doc(userId).set({ likedMediaIds }, { merge: true }).catch(() => {});
  }

  return likedMediaIds;
}

exports.followUser = catchAsync(async (req, res, next) => {
  const { uid, username, photoURL } = req.user;
  const targetHandle = req.body.targetUsername || req.body.targetUserId;
  const targetUserId = await getUidByUsername(targetHandle);

  if (uid === targetUserId) return next(new AppError("Você não pode seguir a si mesmo.", 400));

  await db.runTransaction(async (t) => {
    const targetRef = db.collection("users").doc(targetUserId);
    const meRef = db.collection("users").doc(uid);
    const targetDoc = await t.get(targetRef);

    if (!targetDoc.exists) throw new Error("Usuário alvo não encontrado no banco.");

    const targetData = targetDoc.data();
    const newFollowerCount = (targetData.followersCount || 0) + 1;
    const trophiesToAdd = checkTrophies(targetData, "followers", newFollowerCount);

    const updates = { followersCount: newFollowerCount };
    if (trophiesToAdd.length > 0) {
      updates.trophies = admin.firestore.FieldValue.arrayUnion(...trophiesToAdd);
    }

    const followingRef = meRef.collection("following").doc(targetUserId);
    const followerRef = targetRef.collection("followers").doc(uid);

    t.set(followingRef, { since: new Date() });
    t.set(followerRef, { since: new Date() });
    t.update(meRef, { followingCount: admin.firestore.FieldValue.increment(1) });
    t.update(targetRef, updates);

    const notifRef = db.collection("notifications").doc();
    t.set(notifRef, {
      recipientId: targetUserId,
      senderId: uid,
      senderName: username || "Usuário",
      senderPhoto: photoURL || null,
      type: "follow",
      title: "Novo Seguidor",
      message: `${username || "Alguém"} começou a seguir você.`,
      read: false,
      createdAt: new Date(),
      icon: "UserPlus",
    });

    if (trophiesToAdd.length > 0) {
      const trophyNotifRef = db.collection("notifications").doc();
      t.set(trophyNotifRef, {
        recipientId: targetUserId,
        type: "level_up",
        title: "Nova Conquista!",
        message: `Você desbloqueou: ${trophiesToAdd[0].title}`,
        read: false,
        createdAt: new Date(),
        icon: "Award",
      });
    }
  });

  await deleteByPrefix("feed:");
  await deleteByPrefix("notifications:");


  res.status(200).json({ message: "Seguindo." });
});

exports.unfollowUser = catchAsync(async (req, res, next) => {
  const { uid } = req.user;
  const targetHandle = req.params.targetUsername || req.params.targetUserId;
  const targetUserId = await getUidByUsername(targetHandle);

  const batch = db.batch();
  batch.delete(db.collection("users").doc(uid).collection("following").doc(targetUserId));
  batch.delete(db.collection("users").doc(targetUserId).collection("followers").doc(uid));
  batch.update(db.collection("users").doc(uid), {
    followingCount: admin.firestore.FieldValue.increment(-1),
  });
  batch.update(db.collection("users").doc(targetUserId), {
    followersCount: admin.firestore.FieldValue.increment(-1),
  });
  await batch.commit();

  await deleteByPrefix("feed:");
  res.status(200).json({ message: "Deixou de seguir." });
});

exports.checkFollowStatus = catchAsync(async (req, res, next) => {
  const { uid } = req.user;
  const targetHandle = req.params.targetUsername || req.params.targetUserId;

  let targetUserId;
  try {
    targetUserId = await getUidByUsername(targetHandle);
  } catch (error) {
    return res.status(200).json({ isFollowing: false });
  }

  const doc = await db.collection("users").doc(uid).collection("following").doc(targetUserId).get();
  res.status(200).json({ isFollowing: doc.exists });
});

exports.getProfileStats = catchAsync(async (req, res, next) => {
  const targetHandle = req.params.targetUsername || req.params.userId;

  let userId;
  try {
    userId = await getUidByUsername(targetHandle);
  } catch (e) {
    return res.status(200).json({ followersCount: 0, followingCount: 0 });
  }

  const userDoc = await db.collection("users").doc(userId).get();
  if (!userDoc.exists) return res.status(200).json({ followersCount: 0, followingCount: 0 });

  const userData = userDoc.data();
  res.status(200).json({
    followersCount: userData.followersCount || 0,
    followingCount: userData.followingCount || 0,
    xp: userData.xp || 0,
    totalXp: userData.totalXp || 0,
    level: userData.level || 1,
    levelTitle: userData.levelTitle || "Espectador",
    trophies: userData.trophies || [],
  });
});

exports.getMatchPercentage = catchAsync(async (req, res, next) => {
  const { uid } = req.user;
  const targetHandle = req.params.targetUsername || req.params.targetUserId;
  const targetUserId = await getUidByUsername(targetHandle);

  const [myLikes, targetLikes] = await Promise.all([
    getLikedMediaIdsForUser(uid),
    getLikedMediaIdsForUser(targetUserId),
  ]);

  const mySet = new Set(myLikes);
  const targetSet = new Set(targetLikes);

  if (mySet.size === 0 || targetSet.size === 0) return res.json({ percentage: 0 });

  let common = 0;
  mySet.forEach((id) => {
    if (targetSet.has(id)) common += 1;
  });

  const union = new Set([...mySet, ...targetSet]).size;
  const percentage = Math.round((common / union) * 100);
  res.json({ percentage });
});

exports.getUserFollowersList = catchAsync(async (req, res, next) => {
  const { userId } = req.params;
  const { uid } = req.user;
  const wantsPaged = req.query.paged === "true";

  try {
    const result = await getUserSocialList({
      userId,
      collectionName: "followers",
      requesterUid: uid,
      paged: wantsPaged ? { cursor: req.query.cursor, limit: req.query.limit } : null,
    });
    res.status(200).json(result);
  } catch {
    res.status(200).json(wantsPaged ? { items: [], hasMore: false, nextCursor: null } : []);
  }
});

exports.getUserFollowingList = catchAsync(async (req, res, next) => {
  const { userId } = req.params;
  const { uid } = req.user;
  const wantsPaged = req.query.paged === "true";

  try {
    const result = await getUserSocialList({
      userId,
      collectionName: "following",
      requesterUid: uid,
      paged: wantsPaged ? { cursor: req.query.cursor, limit: req.query.limit } : null,
    });
    res.status(200).json(result);
  } catch {
    res.status(200).json(wantsPaged ? { items: [], hasMore: false, nextCursor: null } : []);
  }
});

exports.getSuggestions = catchAsync(async (req, res, next) => {
  const { uid } = req.user;
  const userDoc = await db.collection("users").doc(uid).get();
  const genreCounts = userDoc.data().genreCounts || {};
  const topGenre = Object.keys(genreCounts).reduce(
    (a, b) => (genreCounts[a] > genreCounts[b] ? a : b),
    null
  );

  const followingSnap = await db.collection("users").doc(uid).collection("following").limit(50).get();
  const followingIds = followingSnap.docs.map((doc) => doc.id);
  followingIds.push(uid);

  const snapshot = await db.collection("users").limit(30).get();
  const suggestions = snapshot.docs
    .filter((doc) => !followingIds.includes(doc.id))
    .map((doc) => {
      const data = doc.data();
      const score = (topGenre && data.genreCounts?.[topGenre]) || 0;
      return {
        username: data.username,
        userPhoto: data.photoURL || null,
        levelTitle: data.levelTitle || null,
        score,
      };
    });

  suggestions.sort((a, b) => b.score - a.score);
  res.status(200).json(suggestions.slice(0, 5));
});

exports.getUserStats = catchAsync(async (req, res, next) => {
  const { uid } = req.user;
  const userDoc = await db.collection("users").doc(uid).get();
  const userData = userDoc.data();

  res.status(200).json({
    followersCount: userData.followersCount || 0,
    followingCount: userData.followingCount || 0,
    xp: userData.xp || 0,
    totalXp: userData.totalXp || 0,
    level: userData.level || 1,
    levelTitle: userData.levelTitle || "Espectador",
    trophies: userData.trophies || [],
  });
});
