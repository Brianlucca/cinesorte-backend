const { db } = require('../config/firebase');

const saveList = async (req, res) => {
  const { uid } = req.user;
  const { listName, movies } = req.body;
  if (!listName || !movies) {
    return res.status(400).json({ message: 'Nome da lista e filmes são obrigatórios.' });
  }
  try {
    const listRef = db.collection('users').doc(uid).collection('lists').doc(listName);
    await listRef.set({ movies, createdAt: new Date() });
    res.status(201).json({ message: `Lista '${listName}' salva com sucesso!` });
  } catch (error) {
    console.error("Erro ao salvar lista:", error);
    res.status(500).json({ message: 'Erro interno ao salvar lista.' });
  }
};

const getLists = async (req, res) => {
  const { uid } = req.user;
  try {
    const listsSnapshot = await db.collection('users').doc(uid).collection('lists').orderBy('createdAt', 'desc').get();
    if (listsSnapshot.empty) {
      return res.status(200).json([]);
    }
    const lists = listsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.status(200).json(lists);
  } catch (error) {
    console.error("Erro ao buscar listas:", error);
    res.status(500).json({ message: 'Erro interno ao buscar listas.' });
  }
};

const deleteList = async (req, res) => {
    const { uid } = req.user;
    const { listId } = req.params;
    if (!listId) {
        return res.status(400).json({ message: 'ID da lista é obrigatório.' });
    }
    try {
        const listRef = db.collection('users').doc(uid).collection('lists').doc(listId);
        await listRef.delete();
        res.status(200).json({ message: 'Lista deletada com sucesso.' });
    } catch (error) {
        console.error("Erro ao deletar lista:", error);
        res.status(500).json({ message: 'Erro interno ao deletar lista.' });
    }
};

const removeMovieFromList = async (req, res) => {
    const { uid } = req.user;
    const { listId, movieId } = req.params;

    if (!listId || !movieId) {
        return res.status(400).json({ message: 'ID da lista e ID do filme são obrigatórios.' });
    }

    try {
        const listRef = db.collection('users').doc(uid).collection('lists').doc(listId);
        const doc = await listRef.get();

        if (!doc.exists) {
            return res.status(404).json({ message: 'Lista não encontrada.' });
        }

        const currentMovies = doc.data().movies || [];
        const numericMovieId = parseInt(movieId, 10);
        
        const updatedMovies = currentMovies.filter(movie => movie.id !== numericMovieId);

        await listRef.update({ movies: updatedMovies });

        res.status(200).json({ message: 'Filme removido da lista com sucesso.' });
    } catch (error) {
        console.error("Erro ao remover filme da lista:", error);
        res.status(500).json({ message: 'Erro interno ao remover filme da lista.' });
    }
};

module.exports = {
  saveList,
  getLists,
  deleteList,
  removeMovieFromList,
};