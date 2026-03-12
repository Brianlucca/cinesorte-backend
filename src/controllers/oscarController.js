const { db, admin } = require('../config/firebase');
const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/AppError');

const OSCAR_DEADLINE = new Date('2026-03-16T00:00:00-03:00');

exports.submitVote = catchAsync(async (req, res, next) => {
  if (new Date() >= OSCAR_DEADLINE) {
    return next(new AppError('A votação do Oscar já foi encerrada.', 403));
  }

  const { categoryId, nomineeTmdbId } = req.body;
  const userId = req.user.uid;

  if (!categoryId || !nomineeTmdbId) {
    return next(new AppError('Dados incompletos', 400));
  }

  const voteRef = db.collection('oscarVotes').doc(userId);
  const countsRef = db.collection('oscarCounts').doc(categoryId);

  const voteDoc = await voteRef.get();
  const previousVote = voteDoc.exists ? voteDoc.data()[categoryId] : null;

  const batch = db.batch();

  batch.set(voteRef, {
    [categoryId]: nomineeTmdbId,
    updatedAt: new Date().toISOString()
  }, { merge: true });

  if (previousVote && previousVote !== nomineeTmdbId) {
    batch.set(countsRef, {
      [previousVote]: admin.firestore.FieldValue.increment(-1)
    }, { merge: true });
  }

  if (!previousVote || previousVote !== nomineeTmdbId) {
    batch.set(countsRef, {
      [nomineeTmdbId]: admin.firestore.FieldValue.increment(1)
    }, { merge: true });
  }

  await batch.commit();

  res.status(200).json({
    status: 'success',
    message: 'Voto registrado com sucesso'
  });
});

exports.getUserVotes = catchAsync(async (req, res, next) => {
  const userId = req.user.uid;
  const voteDoc = await db.collection('oscarVotes').doc(userId).get();

  res.status(200).json({
    status: 'success',
    data: voteDoc.exists ? voteDoc.data() : {}
  });
});

exports.getAllVotes = catchAsync(async (req, res, next) => {
  const snapshot = await db.collection('oscarCounts').get();
  const counts = {};
  const winners = {};

  snapshot.forEach(doc => {
    const data = doc.data();
    counts[doc.id] = data;

    let maxVotes = -1;
    let winnerId = null;
    Object.entries(data).forEach(([id, votes]) => {
      if (typeof votes === 'number' && votes > maxVotes) {
        maxVotes = votes;
        winnerId = id;
      }
    });
    winners[doc.id] = winnerId;
  });

  res.status(200).json({
    status: 'success',
    data: {
      counts,
      winners,
      isResultsPhase: new Date() >= OSCAR_DEADLINE
    }
  });
});