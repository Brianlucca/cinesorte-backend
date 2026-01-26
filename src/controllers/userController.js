const { db } = require('../config/firebase');
const admin = require('firebase-admin');

const searchUsers = async (req, res) => {
  const { query } = req.query; 
  if (!query || query.length < 3) return res.status(200).json([]);

  try {
    const snapshot = await db.collection('users')
      .where('username', '>=', query.toLowerCase())
      .where('username', '<=', query.toLowerCase() + '\uf8ff')
      .limit(10)
      .get();

    const users = snapshot.docs.map(doc => ({
        uid: doc.id,
        name: doc.data().name,
        username: doc.data().username,
        photoURL: doc.data().photoURL
    }));

    res.status(200).json(users);
  } catch (error) {
    res.status(500).json({ message: 'Erro na busca.' });
  }
};

const getUserProfile = async (req, res) => {
    const { username } = req.params;
    try {
        const snapshot = await db.collection('users').where('username', '==', username).limit(1).get();
        if(snapshot.empty) return res.status(404).json({ message: 'Usuário não encontrado' });
        
        const userDoc = snapshot.docs[0];
        const userData = userDoc.data();
        delete userData.email; 
        
        res.status(200).json({ uid: userDoc.id, ...userData });
    } catch(error) {
        res.status(500).json({ message: 'Erro ao buscar perfil' });
    }
}

const acceptTerms = async (req, res) => {
    const { uid } = req.user;
    const { version } = req.body;
    
    try {
        await db.collection('users').doc(uid).update({
            termsVersion: version,
            termsAcceptedAt: new Date(),
            termsAcceptedUserAgent: req.headers['user-agent'] || 'unknown'
        });
        res.status(200).json({ message: 'Termos aceitos.' });
    } catch (error) { res.status(500).json({ message: 'Erro.' }); }
};

const deleteAccount = async (req, res) => {
    const { uid } = req.user;
    
    try {
        await db.collection('users').doc(uid).delete();
        await admin.auth().deleteUser(uid);
        
        res.status(200).json({ message: 'Conta excluída permanentemente.' });
    } catch (error) {
        console.error("Erro ao deletar conta:", error);
        res.status(500).json({ message: 'Erro ao excluir conta.' });
    }
};

module.exports = { searchUsers, getUserProfile, acceptTerms, deleteAccount };