const { db } = require("../config/firebase");
const admin = require("firebase-admin");
const { checkTrophies } = require("../utils/gamification");

const followUser = async (req, res) => {
  const { uid, username, photoURL } = req.user;
  const { targetUserId } = req.body;

  if (uid === targetUserId) return res.status(400).json({ message: "Erro." });

  try {
    await db.runTransaction(async (t) => {
        const targetRef = db.collection("users").doc(targetUserId);
        const meRef = db.collection("users").doc(uid);
        
        const targetDoc = await t.get(targetRef);
        if (!targetDoc.exists) throw new Error("Usuário alvo não encontrado");
        
        const targetData = targetDoc.data();
        const newFollowerCount = (targetData.followersCount || 0) + 1;

        const trophiesToAdd = checkTrophies(targetData, "followers", newFollowerCount);
        
        const updates = {
            followersCount: newFollowerCount
        };

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
            icon: "UserPlus"
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
                icon: "Award"
            });
        }
    });

    res.status(200).json({ message: "Seguindo." });
  } catch (error) {
    res.status(500).json({ message: "Erro." });
  }
};

const unfollowUser = async (req, res) => {
  const { uid } = req.user;
  const { targetUserId } = req.params;
  try {
    const batch = db.batch();
    batch.delete(db.collection("users").doc(uid).collection("following").doc(targetUserId));
    batch.delete(db.collection("users").doc(targetUserId).collection("followers").doc(uid));
    batch.update(db.collection("users").doc(uid), { followingCount: admin.firestore.FieldValue.increment(-1) });
    batch.update(db.collection("users").doc(targetUserId), { followersCount: admin.firestore.FieldValue.increment(-1) });
    await batch.commit();
    res.status(200).json({ message: "Deixou de seguir." });
  } catch (error) {
    res.status(500).json({ message: "Erro." });
  }
};

const checkFollowStatus = async (req, res) => {
  const { uid } = req.user;
  const { targetUserId } = req.params;
  try {
    const doc = await db.collection("users").doc(uid).collection("following").doc(targetUserId).get();
    res.status(200).json({ isFollowing: doc.exists });
  } catch (error) {
    res.status(500).json({ isFollowing: false });
  }
};

const getUserStats = async (req, res) => {
  const { uid } = req.user;
  try {
    const userDoc = await db.collection("users").doc(uid).get();
    const userData = userDoc.data();
    const followersSnap = await db.collection("users").doc(uid).collection("followers").get();
    const followingSnap = await db.collection("users").doc(uid).collection("following").get();
    res.status(200).json({
      followersCount: followersSnap.size,
      followingCount: followingSnap.size,
      xp: userData.xp || 0,
      totalXp: userData.totalXp || 0,
      level: userData.level || 1,
      levelTitle: userData.levelTitle || "Espectador",
      trophies: userData.trophies || [],
    });
  } catch (error) {
    res.status(500).json({ followersCount: 0, followingCount: 0 });
  }
};

const getProfileStats = async (req, res) => {
  const { userId } = req.params;
  try {
    const userDoc = await db.collection("users").doc(userId).get();
    const userData = userDoc.data();
    const followersSnap = await db.collection("users").doc(userId).collection("followers").get();
    const followingSnap = await db.collection("users").doc(userId).collection("following").get();
    res.status(200).json({
      followersCount: followersSnap.size,
      followingCount: followingSnap.size,
      xp: userData.xp || 0,
      totalXp: userData.totalXp || 0,
      level: userData.level || 1,
      levelTitle: userData.levelTitle || "Espectador",
      trophies: userData.trophies || [],
    });
  } catch (error) {
    res.status(500).json({ followersCount: 0, followingCount: 0 });
  }
};

const getSuggestions = async (req, res) => {
  const { uid } = req.user;
  try {
    const userDoc = await db.collection("users").doc(uid).get();
    const genreCounts = userDoc.data().genreCounts || {};
    const topGenre = Object.keys(genreCounts).reduce((a, b) => (genreCounts[a] > genreCounts[b] ? a : b), null);
    const followingSnap = await db.collection("users").doc(uid).collection("following").get();
    const followingIds = followingSnap.docs.map((doc) => doc.id);
    followingIds.push(uid);
    const snapshot = await db.collection("users").limit(30).get();
    const suggestions = snapshot.docs.filter((doc) => !followingIds.includes(doc.id)).map((doc) => {
      const data = doc.data();
      let score = (topGenre && data.genreCounts?.[topGenre]) || 0;
      return { id: doc.id, ...data, score };
    });
    suggestions.sort((a, b) => b.score - a.score);
    res.status(200).json(suggestions.slice(0, 5));
  } catch (error) {
    res.status(500).json([]);
  }
};

const getMatchPercentage = async (req, res) => {
  const { uid } = req.user;
  const { targetUserId } = req.params;
  try {
    const [myLikes, targetLikes] = await Promise.all([
      db.collection("interactions").where("userId", "==", uid).where("liked", "==", true).get(),
      db.collection("interactions").where("userId", "==", targetUserId).where("liked", "==", true).get(),
    ]);
    const mySet = new Set(myLikes.docs.map((d) => d.data().mediaId));
    const targetSet = new Set(targetLikes.docs.map((d) => d.data().mediaId));
    if (mySet.size === 0 || targetSet.size === 0) return res.json({ percentage: 0 });
    let common = 0;
    mySet.forEach((id) => { if (targetSet.has(id)) common++; });
    const union = new Set([...mySet, ...targetSet]).size;
    const percentage = Math.round((common / union) * 100);
    res.json({ percentage });
  } catch (error) {
    res.status(500).json({ percentage: 0 });
  }
};

const getUserFollowersList = async (req, res) => {
  const { userId } = req.params;
  try {
    const snapshot = await db.collection("users").doc(userId).collection("followers").limit(50).get();
    if (snapshot.empty) return res.status(200).json([]);
    const userRefs = snapshot.docs.map(doc => db.collection("users").doc(doc.id));
    if (userRefs.length === 0) return res.status(200).json([]);
    const usersDocs = await db.getAll(...userRefs);
    res.status(200).json(usersDocs.filter((doc) => doc.exists).map((doc) => ({ id: doc.id, ...doc.data() })));
  } catch (error) {
    res.status(500).json([]);
  }
};

const getUserFollowingList = async (req, res) => {
  const { userId } = req.params;
  try {
    const snapshot = await db.collection("users").doc(userId).collection("following").limit(50).get();
    if (snapshot.empty) return res.status(200).json([]);
    const userRefs = snapshot.docs.map(doc => db.collection("users").doc(doc.id));
    if (userRefs.length === 0) return res.status(200).json([]);
    const usersDocs = await db.getAll(...userRefs);
    res.status(200).json(usersDocs.filter((doc) => doc.exists).map((doc) => ({ id: doc.id, ...doc.data() })));
  } catch (error) {
    res.status(500).json([]);
  }
};

module.exports = {
  followUser,
  unfollowUser,
  checkFollowStatus,
  getUserStats,
  getProfileStats,
  getSuggestions,
  getMatchPercentage,
  getUserFollowersList,
  getUserFollowingList
};