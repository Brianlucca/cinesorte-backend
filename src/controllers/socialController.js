const { db } = require('../config/firebase');

const followUser = async (req, res) => {
  const { uid } = req.user;
  const { targetUserId } = req.body;

  if (uid === targetUserId) {
    return res.status(400).json({ message: 'Cannot follow yourself' });
  }

  try {
    const batch = db.batch();

    const followingRef = db.collection('users').doc(uid).collection('following').doc(targetUserId);
    batch.set(followingRef, { since: new Date() });

    const followerRef = db.collection('users').doc(targetUserId).collection('followers').doc(uid);
    batch.set(followerRef, { since: new Date() });

    await batch.commit();
    res.status(200).json({ message: 'Followed successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Error following user' });
  }
};

const unfollowUser = async (req, res) => {
  const { uid } = req.user;
  const { targetUserId } = req.params;

  try {
    const batch = db.batch();
    const followingRef = db.collection('users').doc(uid).collection('following').doc(targetUserId);
    const followerRef = db.collection('users').doc(targetUserId).collection('followers').doc(uid);

    batch.delete(followingRef);
    batch.delete(followerRef);

    await batch.commit();
    res.status(200).json({ message: 'Unfollowed successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Error unfollowing user' });
  }
};

const addReview = async (req, res) => {
  const { uid, name } = req.user;
  const { mediaId, mediaType, rating, text, mediaTitle, posterPath } = req.body;

  if (rating === undefined || rating < 0 || rating > 5) {
    return res.status(400).json({ message: 'Rating must be between 0 and 5' });
  }

  try {
    await db.collection('reviews').add({
      userId: uid,
      userName: name || 'User',
      mediaId: mediaId.toString(),
      mediaType,
      mediaTitle,
      posterPath,
      rating,
      text: text || '',
      likesCount: 0,
      createdAt: new Date()
    });
    res.status(201).json({ message: 'Review published' });
  } catch (error) {
    res.status(500).json({ message: 'Error publishing review' });
  }
};

const getMediaReviews = async (req, res) => {
  const { mediaId } = req.params;

  try {
    const snapshot = await db.collection('reviews')
      .where('mediaId', '==', mediaId)
      .orderBy('createdAt', 'desc')
      .limit(20)
      .get();

    const reviews = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.status(200).json(reviews);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching reviews' });
  }
};

module.exports = {
  followUser,
  unfollowUser,
  addReview,
  getMediaReviews
};