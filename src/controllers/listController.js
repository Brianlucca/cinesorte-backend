const { db } = require('../config/firebase');

const upsertList = async (req, res) => {
  const { uid } = req.user;
  const { listName, mediaItem } = req.body;

  if (!listName || !mediaItem) {
    return res.status(400).json({ message: 'List name and media item required' });
  }

  try {
    const listRef = db.collection('users').doc(uid).collection('lists').doc(listName);
    const doc = await listRef.get();

    let items = [];
    if (doc.exists) {
      items = doc.data().items || [];
    }

    const exists = items.some(item => item.id === mediaItem.id);
    if (!exists) {
      items.push({ ...mediaItem, addedAt: new Date() });
      await listRef.set({ items, updatedAt: new Date() }, { merge: true });
    }

    res.status(200).json({ message: 'Item added to list' });
  } catch (error) {
    res.status(500).json({ message: 'Error updating list' });
  }
};

const getUserLists = async (req, res) => {
  const { uid } = req.user;
  try {
    const listsSnapshot = await db.collection('users').doc(uid).collection('lists').get();
    const lists = listsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.status(200).json(lists);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching lists' });
  }
};

const deleteList = async (req, res) => {
  const { uid } = req.user;
  const { listId } = req.params;

  try {
    await db.collection('users').doc(uid).collection('lists').doc(listId).delete();
    res.status(200).json({ message: 'List deleted' });
  } catch (error) {
    res.status(500).json({ message: 'Error deleting list' });
  }
};

const removeMediaFromList = async (req, res) => {
  const { uid } = req.user;
  const { listId, mediaId } = req.params;

  try {
    const listRef = db.collection('users').doc(uid).collection('lists').doc(listId);
    const doc = await listRef.get();

    if (!doc.exists) {
      return res.status(404).json({ message: 'List not found' });
    }

    const currentItems = doc.data().items || [];
    const updatedItems = currentItems.filter(item => item.id.toString() !== mediaId);

    await listRef.update({ items: updatedItems, updatedAt: new Date() });
    res.status(200).json({ message: 'Item removed' });
  } catch (error) {
    res.status(500).json({ message: 'Error removing item' });
  }
};

module.exports = {
  upsertList,
  getUserLists,
  deleteList,
  removeMediaFromList,
};