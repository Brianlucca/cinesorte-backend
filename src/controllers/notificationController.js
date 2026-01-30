const { db } = require("../config/firebase");
const catchAsync = require("../utils/catchAsync");

exports.getNotifications = catchAsync(async (req, res, next) => {
  const { uid } = req.user;
  const snapshot = await db
    .collection("notifications")
    .where("recipientId", "==", uid)
    .get();

  const notifications = snapshot.docs.map((doc) => {
    const data = doc.data();
    let createdDate;
    if (data.createdAt && typeof data.createdAt.toDate === "function") {
      createdDate = data.createdAt.toDate();
    } else if (data.createdAt) {
      createdDate = new Date(data.createdAt);
    } else {
      createdDate = new Date();
    }
    return { id: doc.id, ...data, createdAt: createdDate };
  });

  notifications.sort((a, b) => b.createdAt - a.createdAt);
  res.status(200).json(notifications.slice(0, 20));
});

exports.markAsRead = catchAsync(async (req, res, next) => {
  const { notificationId } = req.params;
  const { uid } = req.user;

  const notifRef = db.collection("notifications").doc(notificationId);
  const doc = await notifRef.get();

  if (doc.exists && doc.data().recipientId === uid) {
    await notifRef.update({ read: true });
  }
  res.status(200).json({ message: "Lida." });
});

exports.getUnreadCount = catchAsync(async (req, res, next) => {
  const { uid } = req.user;
  const snapshot = await db
    .collection("notifications")
    .where("recipientId", "==", uid)
    .where("read", "==", false)
    .get();
  res.status(200).json({ count: snapshot.size });
});
