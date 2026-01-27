const { db } = require("../config/firebase");

const getNotifications = async (req, res) => {
  const { uid } = req.user;
  try {
    const snapshot = await db
      .collection("notifications")
      .where("recipientId", "==", uid)
      .get();

    const notifications = snapshot.docs.map((doc) => {
        const data = doc.data();
        let createdDate;
        
        if (data.createdAt && typeof data.createdAt.toDate === 'function') {
            createdDate = data.createdAt.toDate();
        } else if (data.createdAt) {
            createdDate = new Date(data.createdAt);
        } else {
            createdDate = new Date();
        }

        return {
            id: doc.id,
            ...data,
            createdAt: createdDate
        };
    });

    notifications.sort((a, b) => b.createdAt - a.createdAt);

    res.status(200).json(notifications.slice(0, 20));
  } catch (error) {
    res.status(500).json({ message: "Erro ao buscar notificações." });
  }
};

const markAsRead = async (req, res) => {
  const { notificationId } = req.params;
  try {
    await db.collection("notifications").doc(notificationId).update({ read: true });
    res.status(200).json({ message: "Lida." });
  } catch (error) {
    res.status(500).json({ message: "Erro." });
  }
};

const getUnreadCount = async (req, res) => {
  const { uid } = req.user;
  try {
    const snapshot = await db
      .collection("notifications")
      .where("recipientId", "==", uid)
      .where("read", "==", false)
      .get();
    
    res.status(200).json({ count: snapshot.size });
  } catch (error) {
    res.status(500).json({ count: 0 });
  }
};

module.exports = { getNotifications, markAsRead, getUnreadCount };