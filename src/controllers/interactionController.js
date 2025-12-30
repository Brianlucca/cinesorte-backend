const { db } = require('../config/firebase');

const recordInteraction = async (req, res) => {
  const { uid } = req.user;
  const { mediaId, mediaType, action } = req.body;

  if (!mediaId || !mediaType || !['like', 'dislike', 'watched'].includes(action)) {
    return res.status(400).json({ message: 'Invalid data' });
  }

  try {
    const docId = `${uid}_${mediaId}`;
    await db.collection('interactions').doc(docId).set({
      userId: uid,
      mediaId: mediaId.toString(),
      mediaType,
      action,
      timestamp: new Date()
    });

    res.status(200).json({ message: 'Interaction recorded' });
  } catch (error) {
    res.status(500).json({ message: 'Internal error' });
  }
};

const getUserInteractions = async (req, res) => {
  const { uid } = req.user;
  const { action } = req.query;

  try {
    let query = db.collection('interactions').where('userId', '==', uid);
    
    if (action) {
      query = query.where('action', '==', action);
    }

    const snapshot = await query.orderBy('timestamp', 'desc').get();
    const interactions = snapshot.docs.map(doc => doc.data());
    res.status(200).json(interactions);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching interactions' });
  }
};

module.exports = {
  recordInteraction,
  getUserInteractions
};