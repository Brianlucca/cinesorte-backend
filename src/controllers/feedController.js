const { db } = require("../config/firebase");

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
          attachmentId: data.listId,
        };
      }),
    );
    res.status(200).json(feed);
  } catch (error) {
    res.status(500).json({ message: "Erro ao buscar feed de listas." });
  }
};

module.exports = { getGlobalFeed, getFollowingFeed, getSharedListsFeed };
