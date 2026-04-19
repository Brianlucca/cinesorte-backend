const { db } = require("../config/firebase");
const catchAsync = require("../utils/catchAsync");
const { remember, del } = require("../services/cacheService");
const { notificationsCountKey, notificationsListKey } = require("../services/cacheKeys");

exports.getNotifications = catchAsync(async (req, res, next) => {
  const { uid } = req.user;
  const notifications = await remember(notificationsListKey(uid), 10, async () => {
    const snapshot = await db
      .collection("notifications")
      .where("recipientId", "==", uid)
      .orderBy("createdAt", "desc")
      .limit(20)
      .get();

    return snapshot.docs.map((doc) => {
      const data = doc.data();
      let createdDate;
      if (data.createdAt && typeof data.createdAt.toDate === "function") {
        createdDate = data.createdAt.toDate();
      } else if (data.createdAt) {
        createdDate = new Date(data.createdAt);
      } else {
        createdDate = new Date();
      }

      return {
        id: doc.id,
        type: data.type,
        title: data.title,
        message: data.message,
        read: data.read || false,
        createdAt: createdDate,
        icon: data.icon || null,
        mediaId: data.mediaId || null,
        mediaType: data.mediaType || null,
        senderName: data.senderName || null,
        senderUsername: data.senderUsername || null,
        senderPhoto: data.senderPhoto || null,
      };
    });
  });

  res.status(200).json(notifications);
});

exports.markAsRead = catchAsync(async (req, res, next) => {
  const { notificationId } = req.params;
  const { uid } = req.user;

  const notifRef = db.collection("notifications").doc(notificationId);
  const doc = await notifRef.get();

  if (doc.exists && doc.data().recipientId === uid) {
    await notifRef.update({ read: true });
    await del(notificationsListKey(uid));
    await del(notificationsCountKey(uid));
  }
  res.status(200).json({ message: "Lida." });
});

exports.getUnreadCount = catchAsync(async (req, res, next) => {
  const { uid } = req.user;
  const count = await remember(notificationsCountKey(uid), 10, async () => {
    const query = db
      .collection("notifications")
      .where("recipientId", "==", uid)
      .where("read", "==", false);

    try {
      const aggregate = await query.count().get();
      return aggregate.data().count || 0;
    } catch {
      const snapshot = await query.get();
      return snapshot.size;
    }
  });
  return res.status(200).json({ count });
});
