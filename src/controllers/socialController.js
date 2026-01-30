const { db } = require("../config/firebase");
const admin = require("firebase-admin");
const { checkTrophies } = require("../utils/gamification");
const catchAsync = require("../utils/catchAsync");
const AppError = require("../utils/AppError");

async function getUidByUsername(username) {
  if (!username) throw new AppError("Usuário não especificado.", 400);
  
  const snapshot = await db.collection("users").where("username", "==", username).limit(1).get();
  
  if (snapshot.empty) throw new AppError("Usuário não encontrado.", 404);
  return snapshot.docs[0].id;
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
    const trophiesToAdd = checkTrophies(
      targetData,
      "followers",
      newFollowerCount,
    );

    const updates = { followersCount: newFollowerCount };
    if (trophiesToAdd.length > 0)
      updates.trophies = admin.firestore.FieldValue.arrayUnion(
        ...trophiesToAdd,
      );

    const followingRef = meRef.collection("following").doc(targetUserId);
    const followerRef = targetRef.collection("followers").doc(uid);

    t.set(followingRef, { since: new Date() });
    t.set(followerRef, { since: new Date() });
    t.update(meRef, {
      followingCount: admin.firestore.FieldValue.increment(1),
    });
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
  res.status(200).json({ message: "Seguindo." });
});

exports.unfollowUser = catchAsync(async (req, res, next) => {
  const { uid } = req.user;
  const targetHandle = req.params.targetUsername || req.params.targetUserId;
  
  const targetUserId = await getUidByUsername(targetHandle);

  const batch = db.batch();
  batch.delete(
    db.collection("users").doc(uid).collection("following").doc(targetUserId),
  );
  batch.delete(
    db.collection("users").doc(targetUserId).collection("followers").doc(uid),
  );
  batch.update(db.collection("users").doc(uid), {
    followingCount: admin.firestore.FieldValue.increment(-1),
  });
  batch.update(db.collection("users").doc(targetUserId), {
    followersCount: admin.firestore.FieldValue.increment(-1),
  });
  await batch.commit();
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

  const doc = await db
    .collection("users")
    .doc(uid)
    .collection("following")
    .doc(targetUserId)
    .get();
  res.status(200).json({ isFollowing: doc.exists });
});

exports.getProfileStats = catchAsync(async (req, res, next) => {
  const targetHandle = req.params.targetUsername || req.params.userId;
  
  let userId;
  try {
      userId = await getUidByUsername(targetHandle);
  } catch(e) {
      return res.status(200).json({ followersCount: 0, followingCount: 0 });
  }

  const userDoc = await db.collection("users").doc(userId).get();
  if (!userDoc.exists)
    return res.status(200).json({ followersCount: 0, followingCount: 0 });

  const userData = userDoc.data();
  const followersSnap = await db
    .collection("users")
    .doc(userId)
    .collection("followers")
    .get();
  const followingSnap = await db
    .collection("users")
    .doc(userId)
    .collection("following")
    .get();
  res.status(200).json({
    followersCount: followersSnap.size,
    followingCount: followingSnap.size,
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
    db
      .collection("interactions")
      .where("userId", "==", uid)
      .where("liked", "==", true)
      .get(),
    db
      .collection("interactions")
      .where("userId", "==", targetUserId)
      .where("liked", "==", true)
      .get(),
  ]);
  const mySet = new Set(myLikes.docs.map((d) => d.data().mediaId));
  const targetSet = new Set(targetLikes.docs.map((d) => d.data().mediaId));
  if (mySet.size === 0 || targetSet.size === 0)
    return res.json({ percentage: 0 });
  let common = 0;
  mySet.forEach((id) => {
    if (targetSet.has(id)) common++;
  });
  const union = new Set([...mySet, ...targetSet]).size;
  const percentage = Math.round((common / union) * 100);
  res.json({ percentage });
});

exports.getUserFollowersList = catchAsync(async (req, res, next) => {
  const { userId } = req.params; 
  let targetUid = userId;
  if(userId.length < 20) { 
      try { targetUid = await getUidByUsername(userId); } catch(e) { return res.status(200).json([]); }
  }

  const snapshot = await db
    .collection("users")
    .doc(targetUid)
    .collection("followers")
    .limit(50)
    .get();
    
  if (snapshot.empty) return res.status(200).json([]);
  const userRefs = snapshot.docs.map((doc) =>
    db.collection("users").doc(doc.id),
  );
  if (userRefs.length === 0) return res.status(200).json([]);
  const usersDocs = await db.getAll(...userRefs);
  res
    .status(200)
    .json(
      usersDocs
        .filter((doc) => doc.exists)
        .map((doc) => {
          const d = doc.data();
          return {
            username: d.username,
            userPhoto: d.photoURL || null,
            levelTitle: d.levelTitle || null,
          };
        }),
    );
});

exports.getUserFollowingList = catchAsync(async (req, res, next) => {
  const { userId } = req.params;
  let targetUid = userId;
  if(userId.length < 20) { 
      try { targetUid = await getUidByUsername(userId); } catch(e) { return res.status(200).json([]); }
  }

  const snapshot = await db
    .collection("users")
    .doc(targetUid)
    .collection("following")
    .limit(50)
    .get();
  if (snapshot.empty) return res.status(200).json([]);
  const userRefs = snapshot.docs.map((doc) =>
    db.collection("users").doc(doc.id),
  );
  if (userRefs.length === 0) return res.status(200).json([]);
  const usersDocs = await db.getAll(...userRefs);
  res
    .status(200)
    .json(
      usersDocs
        .filter((doc) => doc.exists)
        .map((doc) => {
          const d = doc.data();
          return {
            username: d.username,
            userPhoto: d.photoURL || null,
            levelTitle: d.levelTitle || null,
          };
        }),
    );
});

exports.getSuggestions = catchAsync(async (req, res, next) => {
  const { uid } = req.user;
  const userDoc = await db.collection("users").doc(uid).get();
  const genreCounts = userDoc.data().genreCounts || {};
  const topGenre = Object.keys(genreCounts).reduce(
    (a, b) => (genreCounts[a] > genreCounts[b] ? a : b),
    null,
  );
  const followingSnap = await db
    .collection("users")
    .doc(uid)
    .collection("following")
    .get();
  const followingIds = followingSnap.docs.map((doc) => doc.id);
  followingIds.push(uid);
  const snapshot = await db.collection("users").limit(30).get();
  const suggestions = snapshot.docs
    .filter((doc) => !followingIds.includes(doc.id))
    .map((doc) => {
      const data = doc.data();
      let score = (topGenre && data.genreCounts?.[topGenre]) || 0;
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
  const followersSnap = await db
    .collection("users")
    .doc(uid)
    .collection("followers")
    .get();
  const followingSnap = await db
    .collection("users")
    .doc(uid)
    .collection("following")
    .get();
  res.status(200).json({
    followersCount: followersSnap.size,
    followingCount: followingSnap.size,
    xp: userData.xp || 0,
    totalXp: userData.totalXp || 0,
    level: userData.level || 1,
    levelTitle: userData.levelTitle || "Espectador",
    trophies: userData.trophies || [],
  });
});