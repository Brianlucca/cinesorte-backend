const { db } = require("../config/firebase");
const admin = require("firebase-admin");
const {
  reviewSchema,
  commentSchema,
  containsProfanity,
} = require("../utils/validators");
const tmdbApi = require("../api/tmdb");

const calculateLevelTitle = (reviewsCount) => {
  if (reviewsCount >= 50) return "Mestre da Crítica";
  if (reviewsCount >= 20) return "Cinéfilo";
  if (reviewsCount >= 5) return "Crítico Iniciante";
  return "Espectador";
};

const getXPNeeded = (level) => {
  return 100 + (level - 1) * 50;
};

const checkTrophies = (userData, type, value) => {
  const newTrophies = [];
  const currentTrophyIds = new Set((userData.trophies || []).map((t) => t.id));

  const trophiesList = [
    {
      id: "rev_1",
      title: "Primeira de Muitas",
      criteria: "reviews",
      threshold: 1,
      icon: "Award",
    },
    {
      id: "rev_10",
      title: "Crítico em Ascensão",
      criteria: "reviews",
      threshold: 10,
      icon: "Zap",
    },
    {
      id: "rev_50",
      title: "Lenda das Reviews",
      criteria: "reviews",
      threshold: 50,
      icon: "Crown",
    },
    {
      id: "xp_1000",
      title: "Veterano do CineSorte",
      criteria: "totalXp",
      threshold: 1000,
      icon: "ShieldCheck",
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

const shareList = async (req, res) => {
  const { uid } = req.user;
  const { listId, content } = req.body;

  try {
    const listDoc = await db.collection('users').doc(uid).collection('lists').doc(listId).get();
    
    if (!listDoc.exists) {
        return res.status(404).json({ message: "Lista não encontrada." });
    }
    const listData = listDoc.data();
    
    if (!listData.isPublic) {
        return res.status(400).json({ message: "Você só pode compartilhar listas públicas." });
    }

    const userDoc = await db.collection('users').doc(uid).get();
    const userData = userDoc.data();

    const newShare = {
      userId: uid,
      username: userData.username,
      userPhoto: userData.photoURL || null,
      levelTitle: userData.levelTitle || 'Espectador',
      listId: listId,
      listName: listData.name, 
      content: content || `Confira minha nova coleção: ${listData.name}`,
      type: 'list_share', 
      createdAt: new Date(),
      likesCount: 0,
      commentsCount: 0
    };

    const docRef = await db.collection('shared_lists').add(newShare);
    res.status(201).json({ id: docRef.id, message: "Coleção compartilhada com sucesso!" });
  } catch (error) {
    res.status(500).json({ message: "Erro ao compartilhar coleção." });
  }
};

const getSharedListsFeed = async (req, res) => {
  try {
    const snapshot = await db
      .collection("shared_lists")
      .orderBy("createdAt", "desc")
      .limit(20)
      .get();

    const feed = await Promise.all(
      snapshot.docs.map(async (doc) => {
        const data = doc.data();
        let listItems = [];
        let listCount = 0;
        let currentListName = data.listName;

        try {
          const listDoc = await db
            .collection("users")
            .doc(data.userId)
            .collection("lists")
            .doc(data.listId)
            .get();

          if (listDoc.exists) {
            const listData = listDoc.data();
            currentListName = listData.name;
            listCount = listData.items?.length || 0;
            listItems = listData.items?.slice(0, 4) || [];
          }
        } catch (e) {}

        return {
          id: doc.id,
          ...data,
          username: data.username || "Usuário",
          userPhoto: data.userPhoto || null,
          listName: currentListName,
          listCount,
          listItems,
          attachmentId: data.listId 
        };
      }),
    );

    res.status(200).json(feed);
  } catch (error) {
    res.status(500).json({ message: "Erro ao buscar feed de listas." });
  }
};

const addReview = async (req, res) => {
  const { uid } = req.user;
  const validation = reviewSchema.safeParse(req.body);
  if (!validation.success)
    return res.status(400).json({ errors: validation.error.errors });

  const {
    mediaId,
    mediaType,
    rating,
    text,
    mediaTitle,
    posterPath,
    backdropPath,
  } = validation.data;
  if (containsProfanity(text))
    return res.status(400).json({ message: "Conteúdo impróprio." });

  try {
    const userRef = db.collection("users").doc(uid);
    const reviewData = {
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
    };

    await db.runTransaction(async (t) => {
      const userDoc = await t.get(userRef);
      const userData = userDoc.data();

      const xpEarned = 20;
      let currentXp = (userData.xp || 0) + xpEarned;
      let totalXp = (userData.totalXp || 0) + xpEarned;
      let level = userData.level || 1;
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
        totalXp: totalXp,
        level: level,
        levelTitle: calculateLevelTitle(reviewsCount),
      };

      if (finalTrophies.length > 0) {
        updates.trophies = admin.firestore.FieldValue.arrayUnion(
          ...finalTrophies,
        );
      }

      const reviewRef = db.collection("reviews").doc();
      const reviewPayload = {
        ...reviewData,
        username: userData.username,
        userPhoto: userData.photoURL,
        levelTitle: updates.levelTitle,
      };

      t.set(reviewRef, reviewPayload);
      t.update(userRef, updates);

      if (mediaType !== 'person') {
          try {
            const cleanId = mediaId.replace(/^(movie-|tv-)/, '');
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

    res.status(201).json({ message: "Review salva." });
  } catch (error) {
    res.status(500).json({ message: "Erro ao salvar review." });
  }
};

const getMatchPercentage = async (req, res) => {
  const { uid } = req.user;
  const { targetUserId } = req.params;
  try {
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
  } catch (error) {
    res.status(500).json({ percentage: 0 });
  }
};

const followUser = async (req, res) => {
  const { uid } = req.user;
  const { targetUserId } = req.body;
  if (uid === targetUserId) return res.status(400).json({ message: "Erro." });
  try {
    const batch = db.batch();
    const followingRef = db
      .collection("users")
      .doc(uid)
      .collection("following")
      .doc(targetUserId);
    const followerRef = db
      .collection("users")
      .doc(targetUserId)
      .collection("followers")
      .doc(uid);
    batch.set(followingRef, { since: new Date() });
    batch.set(followerRef, { since: new Date() });
    batch.update(db.collection("users").doc(uid), {
      followingCount: admin.firestore.FieldValue.increment(1),
    });
    batch.update(db.collection("users").doc(targetUserId), {
      followersCount: admin.firestore.FieldValue.increment(1),
    });
    await batch.commit();
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
  } catch (error) {
    res.status(500).json({ message: "Erro." });
  }
};

const getGlobalFeed = async (req, res) => {
  const { uid } = req.user || {};
  try {
    let query = db.collection("reviews").orderBy("createdAt", "desc").limit(20);
    const snapshot = await query.get();
    const feed = await Promise.all(
      snapshot.docs.map(async (doc) => {
        const data = doc.data();
        let isLikedByCurrentUser = false;
        if (uid) {
          const likeSnap = await db
            .collection("reviews")
            .doc(doc.id)
            .collection("likes")
            .doc(uid)
            .get();
          isLikedByCurrentUser = likeSnap.exists;
        }
        return { id: doc.id, ...data, isLikedByCurrentUser, replies: [] };
      }),
    );
    res.status(200).json(feed);
  } catch (error) {
    res.status(500).json({ message: "Erro." });
  }
};

const getFollowingFeed = async (req, res) => {
  const { uid } = req.user;
  try {
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
    
    const userRefs = followingIds.slice(0, 10).map(id => db.collection("users").doc(id));
    const snap = await db
      .collection("reviews")
      .where("userId", "in", followingIds.slice(0, 10))
      .limit(10)
      .get();
      
    const allReviews = await Promise.all(
      snap.docs.map(async (d) => {
        const data = d.data();
        const likeSnap = await db
          .collection("reviews")
          .doc(d.id)
          .collection("likes")
          .doc(uid)
          .get();
        return {
          id: d.id,
          ...data,
          isLikedByCurrentUser: likeSnap.exists,
          replies: [],
        };
      }),
    );
    allReviews.sort(
      (a, b) =>
        (b.createdAt?.toDate?.() || new Date(b.createdAt)) -
        (a.createdAt?.toDate?.() || new Date(a.createdAt)),
    );
    res.status(200).json(allReviews);
  } catch (error) {
    res.status(500).json({ message: "Erro." });
  }
};

const deleteReview = async (req, res) => {
  const { uid } = req.user;
  const { reviewId } = req.params;
  try {
    const reviewRef = db.collection("reviews").doc(reviewId);
    const doc = await reviewRef.get();
    if (!doc.exists)
      return res.status(404).json({ message: "Não encontrada." });
    if (doc.data().userId !== uid)
      return res.status(403).json({ message: "Sem permissão." });
    const batch = db.batch();
    batch.delete(reviewRef);
    const commentsSnapshot = await db
      .collection("comments")
      .where("reviewId", "==", reviewId)
      .get();
    commentsSnapshot.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
    res.status(200).json({ message: "Review deletada." });
  } catch (error) {
    res.status(500).json({ message: "Erro." });
  }
};

const getMediaReviews = async (req, res) => {
  const { mediaId } = req.params;
  const { uid } = req.user || {};
  try {
    const snapshot = await db
      .collection("reviews")
      .where("mediaId", "==", mediaId)
      .get();
    let reviews = await Promise.all(
      snapshot.docs.map(async (doc) => {
        const data = doc.data();
        let isLiked = false;
        if (uid) {
          const likeSnap = await db
            .collection("reviews")
            .doc(doc.id)
            .collection("likes")
            .doc(uid)
            .get();
          isLiked = likeSnap.exists;
        }
        return { id: doc.id, ...data, replies: [], isLikedByCurrentUser: isLiked };
      }),
    );
    reviews.sort(
      (a, b) =>
        (b.createdAt?.toDate?.() || new Date(b.createdAt)) -
        (a.createdAt?.toDate?.() || new Date(a.createdAt)),
    );
    res.status(200).json(reviews);
  } catch (error) {
    res.status(500).json({ message: "Erro." });
  }
};

const getUserReviews = async (req, res) => {
  const { username } = req.params;
  const { uid } = req.user || {};
  try {
    const userQuery = await db
      .collection("users")
      .where("username", "==", username)
      .get();
    if (userQuery.empty) return res.status(404).json([]);
    const targetUid = userQuery.docs[0].id;
    const snapshot = await db
      .collection("reviews")
      .where("userId", "==", targetUid)
      .limit(20)
      .get();
    let reviews = await Promise.all(
      snapshot.docs.map(async (doc) => {
        const data = doc.data();
        let isLiked = false;
        if (uid) {
          const likeSnap = await db
            .collection("reviews")
            .doc(doc.id)
            .collection("likes")
            .doc(uid)
            .get();
          isLiked = likeSnap.exists;
        }
        return { id: doc.id, ...data, isLikedByCurrentUser: isLiked, replies: [] };
      }),
    );
    reviews.sort(
      (a, b) =>
        (b.createdAt?.toDate?.() || new Date(b.createdAt)) -
        (a.createdAt?.toDate?.() || new Date(a.createdAt)),
    );
    res.status(200).json(reviews);
  } catch (error) {
    res.status(500).json({ message: "Erro." });
  }
};

const toggleLikeReview = async (req, res) => {
  const { uid, name, photoURL } = req.user; 
  const { reviewId } = req.params;
  const reviewRef = db.collection("reviews").doc(reviewId);
  const likeRef = reviewRef.collection("likes").doc(uid);
  try {
    await db.runTransaction(async (t) => {
      const doc = await t.get(likeRef);
      const reviewDoc = await t.get(reviewRef);
      if (!reviewDoc.exists) throw new Error("Review não encontrada");
      const currentLikes = reviewDoc.data().likesCount || 0;
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
            createdAt: new Date() 
        });
        t.update(reviewRef, { likesCount: currentLikes + 1 });
      }
    });
    res.status(200).json({ message: "Sucesso" });
  } catch (error) {
    res.status(500).json({ message: "Erro." });
  }
};

const addComment = async (req, res) => {
  const { uid } = req.user;

  const validation = commentSchema.safeParse(req.body);
  if (!validation.success)
    return res.status(400).json({ errors: validation.error.errors });

  const { reviewId, text, parentId } = validation.data;

  if (containsProfanity(text))
    return res.status(400).json({ message: "Conteúdo impróprio." });

  try {
    const userDoc = await db.collection("users").doc(uid).get();
    const userData = userDoc.data() || {};
    const commentData = {
      reviewId,
      userId: uid,
      username: userData.username || "Usuário",
      userPhoto: userData.photoURL || null,
      text,
      parentId: parentId || null,
      createdAt: new Date(),
      levelTitle: userData.levelTitle || "Espectador",
    };

    const batch = db.batch();
    const commentRef = db.collection("comments").doc();
    batch.set(commentRef, commentData);
    batch.update(db.collection("reviews").doc(reviewId), {
      commentsCount: admin.firestore.FieldValue.increment(1),
    });
    await batch.commit();
    res.status(201).json({ id: commentRef.id, ...commentData });
  } catch (error) {
    res.status(500).json({ message: "Erro." });
  }
};

const getComments = async (req, res) => {
  const { reviewId } = req.params;
  try {
    const snapshot = await db
      .collection("comments")
      .where("reviewId", "==", reviewId)
      .get();
    const comments = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
    comments.sort(
      (a, b) =>
        (a.createdAt?.toDate?.() || new Date(a.createdAt)) -
        (b.createdAt?.toDate?.() || new Date(b.createdAt)),
    );
    res.status(200).json(comments);
  } catch (error) {
    res.status(500).json({ message: "Erro." });
  }
};

const deleteComment = async (req, res) => {
  const { uid } = req.user;
  const { commentId } = req.params;
  try {
    const ref = db.collection("comments").doc(commentId);
    const doc = await ref.get();

    if (!doc.exists)
      return res.status(404).json({ message: "Não encontrado." });

    if (doc.data().userId !== uid)
      return res.status(403).json({ message: "Proibido." });

    const batch = db.batch();
    batch.delete(ref);
    batch.update(db.collection("reviews").doc(doc.data().reviewId), {
      commentsCount: admin.firestore.FieldValue.increment(-1),
    });
    await batch.commit();
    res.status(200).json({ message: "Deletado." });
  } catch (error) {
    res.status(500).json({ message: "Erro." });
  }
};

const checkFollowStatus = async (req, res) => {
  const { uid } = req.user;
  const { targetUserId } = req.params;
  try {
    const doc = await db
      .collection("users")
      .doc(uid)
      .collection("following")
      .doc(targetUserId)
      .get();
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
  } catch (error) {
    res.status(500).json({ followersCount: 0, followingCount: 0 });
  }
};

const getProfileStats = async (req, res) => {
  const { userId } = req.params;
  try {
    const userDoc = await db.collection("users").doc(userId).get();
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
  } catch (error) {
    res.status(500).json({ followersCount: 0, followingCount: 0 });
  }
};

const getSuggestions = async (req, res) => {
  const { uid } = req.user;
  try {
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
        return { id: doc.id, ...data, score };
      });
    suggestions.sort((a, b) => b.score - a.score);
    res.status(200).json(suggestions.slice(0, 5));
  } catch (error) {
    res.status(500).json([]);
  }
};

const getUserFollowersList = async (req, res) => {
  const { userId } = req.params;
  try {
    const snapshot = await db
      .collection("users")
      .doc(userId)
      .collection("followers")
      .limit(50)
      .get();
    if (snapshot.empty) return res.status(200).json([]);
    
    const userRefs = snapshot.docs.map(doc => db.collection("users").doc(doc.id));
    if (userRefs.length === 0) return res.status(200).json([]);

    const usersDocs = await db.getAll(...userRefs);
    
    res.status(200).json(
        usersDocs
          .filter((doc) => doc.exists)
          .map((doc) => ({ id: doc.id, ...doc.data() }))
      );
  } catch (error) {
    res.status(500).json([]);
  }
};

const getUserFollowingList = async (req, res) => {
  const { userId } = req.params;
  try {
    const snapshot = await db
      .collection("users")
      .doc(userId)
      .collection("following")
      .limit(50)
      .get();
    if (snapshot.empty) return res.status(200).json([]);

    const userRefs = snapshot.docs.map(doc => db.collection("users").doc(doc.id));
    if (userRefs.length === 0) return res.status(200).json([]);

    const usersDocs = await db.getAll(...userRefs);

    res.status(200).json(
        usersDocs
          .filter((doc) => doc.exists)
          .map((doc) => ({ id: doc.id, ...doc.data() }))
      );
  } catch (error) {
    res.status(500).json([]);
  }
};

module.exports = {
  shareList,
  getSharedListsFeed,
  addReview,
  getMatchPercentage,
  followUser,
  unfollowUser,
  getGlobalFeed,
  getFollowingFeed,
  deleteReview,
  getMediaReviews,
  getUserReviews,
  toggleLikeReview,
  addComment,
  getComments,
  deleteComment,
  checkFollowStatus,
  getUserStats,
  getProfileStats,
  getSuggestions,
  getUserFollowersList,
  getUserFollowingList,
};