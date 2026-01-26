const { db } = require('../config/firebase');
const admin = require('firebase-admin');
const { containsProfanity } = require('../utils/validators');

const upsertList = async (req, res) => {
    const { uid } = req.user;
    const { listId, listName, description, isPublic } = req.body;

    if (containsProfanity(listName) || containsProfanity(description)) {
        return res.status(400).json({ message: 'Nome ou descrição impróprios.' });
    }

    try {
        const id = listId || listName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '-' + Date.now().toString().slice(-4);
        const listRef = db.collection('users').doc(uid).collection('lists').doc(id);
        
        const listData = {
            id: id, 
            name: listName,
            description: description || '',
            isPublic: isPublic !== undefined ? isPublic : true,
            updatedAt: new Date()
        };

        if (!listId) {
            listData.items = [];
            listData.createdAt = new Date();
            listData.userId = uid; 
            listData.savesCount = 0;
        }

        await listRef.set(listData, { merge: true });
        res.status(200).json({ message: 'Lista salva.', listId: id });
    } catch (error) { res.status(500).json({ message: 'Erro.' }); }
};

const cloneList = async (req, res) => {
    const { uid } = req.user;
    const { ownerUsername, originalListId } = req.body;

    try {
        const ownerSnap = await db.collection('users').where('username', '==', ownerUsername).limit(1).get();
        if (ownerSnap.empty) return res.status(404).json({ message: 'Dono da lista não encontrado.' });
        
        const ownerId = ownerSnap.docs[0].id;
        
        if (ownerId === uid) {
            return res.status(400).json({ message: 'Você não pode clonar sua própria lista.' });
        }

        const originalListRef = db.collection('users').doc(ownerId).collection('lists').doc(originalListId);
        const originalDoc = await originalListRef.get();

        if (!originalDoc.exists) return res.status(404).json({ message: 'Lista não encontrada.' });
        const data = originalDoc.data();

        if (!data.isPublic) return res.status(403).json({ message: 'Lista privada.' });

        const newListId = `${data.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now().toString().slice(-6)}`;
        
        const newListData = {
            id: newListId,
            userId: uid,
            name: `${data.name}`,
            description: data.description || '',
            items: data.items || [],
            isPublic: true,
            clonedFrom: { 
                listId: originalListId, 
                owner: ownerUsername,
                originalName: data.name 
            },
            savesCount: 0,
            createdAt: new Date(),
            updatedAt: new Date()
        };

        const batch = db.batch();
        batch.set(db.collection('users').doc(uid).collection('lists').doc(newListId), newListData);
        batch.update(originalListRef, {
            savesCount: admin.firestore.FieldValue.increment(1)
        });

        await batch.commit();

        res.status(200).json({ message: 'Lista salva na sua coleção!', newListId });
    } catch (error) { 
        res.status(500).json({ message: 'Erro ao clonar.' }); 
    }
};

const addMediaToList = async (req, res) => {
    const { uid } = req.user;
    const { listId, mediaItem } = req.body;

    try {
        const listRef = db.collection('users').doc(uid).collection('lists').doc(listId);
        const doc = await listRef.get();
        
        if(!doc.exists) return res.status(404).json({message: 'Lista não existe.'});

        const currentItems = doc.data().items || [];
        const exists = currentItems.some(i => i.id.toString() === mediaItem.id.toString());
        
        if(!exists) {
            await listRef.update({
                items: admin.firestore.FieldValue.arrayUnion({ ...mediaItem, addedAt: new Date() }),
                updatedAt: new Date()
            });
        }
        res.status(200).json({ message: 'Adicionado.' });
    } catch (error) { 
        res.status(500).json({ message: 'Erro ao adicionar item.' }); 
    }
};

const getUserLists = async (req, res) => {
    const { username } = req.params;
    const { uid: requestUid } = req.user || {}; 

    try {
        let targetUid;

        if (username === 'me') {
            if (!requestUid) return res.status(401).json({ message: 'Não autenticado.' });
            targetUid = requestUid;
        } else {
            const userQuery = await db.collection('users').where('username', '==', username).get();
            if(userQuery.empty) return res.status(404).json([]);
            targetUid = userQuery.docs[0].id;
        }

        const snapshot = await db.collection('users').doc(targetUid).collection('lists').get();
        
        let lists = snapshot.docs.map(doc => {
            const data = doc.data();
            return {
                id: doc.id,
                ...data,
                savesCount: data.savesCount || 0,
                createdAt: data.createdAt?.toDate ? data.createdAt.toDate() : data.createdAt,
                updatedAt: data.updatedAt?.toDate ? data.updatedAt.toDate() : data.updatedAt
            };
        });

        if (requestUid !== targetUid) {
            lists = lists.filter(l => l.isPublic);
        }

        lists.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

        res.status(200).json(lists);
    } catch (error) { 
        res.status(500).json({ message: 'Erro ao buscar listas.' }); 
    }
};

const getPublicListDetails = async (req, res) => {
    const { username, listId } = req.params;
    
    try {
        const userQuery = await db.collection('users').where('username', '==', username).limit(1).get();
        
        if (userQuery.empty) {
            return res.status(404).json({ message: "Usuário não encontrado." });
        }

        const userId = userQuery.docs[0].id;
        const ownerData = userQuery.docs[0].data();

        const listDoc = await db.collection('users').doc(userId).collection('lists').doc(listId).get();
        
        if (!listDoc.exists) {
            return res.status(404).json({ message: "Lista não encontrada." });
        }

        const listData = listDoc.data();

        if (!listData.isPublic) {
             return res.status(403).json({ message: "Esta lista é privada." });
        }

        res.status(200).json({
            ...listData,
            userId: userId, 
            savesCount: listData.savesCount || 0,
            createdAt: listData.createdAt?.toDate ? listData.createdAt.toDate() : listData.createdAt,
            updatedAt: listData.updatedAt?.toDate ? listData.updatedAt.toDate() : listData.updatedAt,
            owner: {
                username: ownerData.username,
                photoURL: ownerData.photoURL || null,
                name: ownerData.name
            }
        });

    } catch (error) {
        res.status(500).json({ message: "Erro ao carregar lista." });
    }
};

const deleteList = async (req, res) => {
    const { uid } = req.user;
    const { listId } = req.params;
    try {
        await db.collection('users').doc(uid).collection('lists').doc(listId).delete();
        res.status(200).json({ message: 'Lista deletada.' });
    } catch (error) { res.status(500).json({ message: 'Erro.' }); }
};

const removeMediaFromList = async (req, res) => {
    const { uid } = req.user;
    const { listId, mediaId } = req.params;

    try {
        const listRef = db.collection('users').doc(uid).collection('lists').doc(listId);
        const doc = await listRef.get();
        if (!doc.exists) return res.status(404).json({ message: 'Lista não encontrada.' });

        const currentItems = doc.data().items || [];
        const updatedItems = currentItems.filter(item => item.id.toString() !== mediaId.toString());

        await listRef.update({ items: updatedItems, updatedAt: new Date() });
        res.status(200).json({ message: 'Removido.' });
    } catch (error) { res.status(500).json({ message: 'Erro.' }); }
};

module.exports = { 
    upsertList, 
    cloneList, 
    addMediaToList, 
    getUserLists, 
    deleteList, 
    removeMediaFromList,
    getPublicListDetails 
};