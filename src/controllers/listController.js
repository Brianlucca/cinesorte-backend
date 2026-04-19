const { db } = require("../config/firebase");
const admin = require("firebase-admin");
const tmdbApi = require("../api/tmdb");
const { containsProfanity } = require("../utils/profanity");
const catchAsync = require("../utils/catchAsync");
const AppError = require("../utils/AppError");
const { deleteByPrefix } = require("../services/cacheService");

const hasYearData = (item = {}) =>
  Boolean(
    item.year ||
      item.release_date ||
      item.first_air_date ||
      item.releaseDate ||
      item.firstAirDate,
  );

const enrichListItemWithYear = async (item = {}) => {
  if (!item?.id || hasYearData(item)) {
    return item;
  }

  const mediaType = item.media_type || (item.title ? "movie" : "tv");

  try {
    const response = await tmdbApi.get(`/${mediaType}/${item.id}`, {
      params: { language: "pt-BR" },
    });

    const releaseDate =
      response.data?.release_date || item.release_date || item.releaseDate || null;
    const firstAirDate =
      response.data?.first_air_date ||
      item.first_air_date ||
      item.firstAirDate ||
      null;
    const year = (releaseDate || firstAirDate || "").split("-")[0] || null;

    return {
      ...item,
      title: item.title || response.data?.title || response.data?.name || "Sem título",
      name: item.name || response.data?.name || response.data?.title || item.title || "Sem título",
      release_date: releaseDate,
      first_air_date: firstAirDate,
      year,
    };
  } catch (error) {
    return item;
  }
};

const enrichItemsIfNeeded = async (listRef, items = []) => {
  if (!Array.isArray(items) || items.length === 0) {
    return items;
  }

  let changed = false;
  const enrichedItems = await Promise.all(
    items.map(async (item) => {
      if (hasYearData(item)) {
        return item;
      }

      const enrichedItem = await enrichListItemWithYear(item);
      if (enrichedItem !== item && hasYearData(enrichedItem)) {
        changed = true;
      }
      return enrichedItem;
    }),
  );

  if (changed && listRef) {
    await listRef.update({
      items: enrichedItems,
      updatedAt: new Date(),
    });
  }

  return enrichedItems;
};

exports.upsertList = catchAsync(async (req, res, next) => {
  const { uid } = req.user;
  const { listId, listName, description, isPublic } = req.body;

  if (
    containsProfanity(listName) ||
    (description && containsProfanity(description))
  ) {
    return next(new AppError("Nome ou descrição impróprios.", 400));
  }

  const id =
    listId ||
    listName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") +
      "-" +
      Date.now().toString().slice(-4);
  const listRef = db.collection("users").doc(uid).collection("lists").doc(id);

  if (listId) {
    const doc = await listRef.get();
    if (!doc.exists) return next(new AppError("Lista não encontrada.", 404));
  }

  const listData = {
    id,
    name: listName,
    description: description || "",
    isPublic: isPublic !== undefined ? isPublic : true,
    updatedAt: new Date(),
    userId: uid,
  };

  if (!listId) {
    listData.items = [];
    listData.createdAt = new Date();
    listData.savesCount = 0;
  }

  await listRef.set(listData, { merge: true });
  res.status(200).json({ message: "Lista salva.", listId: id });
});

exports.cloneList = catchAsync(async (req, res, next) => {
  const { uid } = req.user;
  const { ownerUsername, originalListId } = req.body;

  const ownerSnap = await db
    .collection("users")
    .where("username", "==", ownerUsername)
    .limit(1)
    .get();
  if (ownerSnap.empty)
    return next(new AppError("Dono da lista não encontrado.", 404));

  const ownerId = ownerSnap.docs[0].id;
  if (ownerId === uid)
    return next(new AppError("Você não pode clonar sua própria lista.", 400));

  const originalListRef = db
    .collection("users")
    .doc(ownerId)
    .collection("lists")
    .doc(originalListId);
  const originalDoc = await originalListRef.get();

  if (!originalDoc.exists)
    return next(new AppError("Lista não encontrada.", 404));
  const data = originalDoc.data();
  if (!data.isPublic) return next(new AppError("Lista privada.", 403));

  const newListId = `${data.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now().toString().slice(-6)}`;
  const newListData = {
    id: newListId,
    userId: uid,
    name: `${data.name}`,
    description: data.description || "",
    items: data.items || [],
    isPublic: true,
    clonedFrom: {
      listId: originalListId,
      owner: ownerUsername,
      originalName: data.name,
    },
    savesCount: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const batch = db.batch();
  batch.set(
    db.collection("users").doc(uid).collection("lists").doc(newListId),
    newListData,
  );
  batch.update(originalListRef, {
    savesCount: admin.firestore.FieldValue.increment(1),
  });
  await batch.commit();

  res.status(200).json({ message: "Lista salva na sua coleção!", newListId });
});

exports.addMediaToList = catchAsync(async (req, res, next) => {
  const { uid } = req.user;
  const { listId, mediaItem } = req.body;

  const listRef = db
    .collection("users")
    .doc(uid)
    .collection("lists")
    .doc(listId);
  const doc = await listRef.get();
  if (!doc.exists)
    return next(
      new AppError("Lista não existe ou você não tem permissão.", 404),
    );

  const safeMediaItem = {
    id: mediaItem.id,
    title: mediaItem.title || mediaItem.name || "Sem título",
    name: mediaItem.name || mediaItem.title || "Sem título",
    poster_path: mediaItem.poster_path || null,
    backdrop_path: mediaItem.backdrop_path || null,
    media_type: mediaItem.media_type || "movie",
    vote_average: mediaItem.vote_average || 0,
    release_date: mediaItem.release_date || null,
    first_air_date: mediaItem.first_air_date || null,
    year:
      (mediaItem.release_date || mediaItem.first_air_date || "").split("-")[0] ||
      null,
    addedAt: new Date(),
  };

  const currentItems = doc.data().items || [];
  const exists = currentItems.some(
    (i) => i.id.toString() === safeMediaItem.id.toString(),
  );

  if (!exists) {
    await listRef.update({
      items: admin.firestore.FieldValue.arrayUnion(safeMediaItem),
      updatedAt: new Date(),
    });
  }
  res.status(200).json({ message: "Adicionado." });
});

exports.getUserLists = catchAsync(async (req, res, next) => {
  const { username } = req.params;
  const { uid: requestUid } = req.user || {};

  let targetUid;
  let isOwner = false;

  if (username === "me") {
    if (!requestUid) return next(new AppError("Não autenticado.", 401));
    targetUid = requestUid;
    isOwner = true;
  } else {
    const userQuery = await db
      .collection("users")
      .where("username", "==", username)
      .get();
    if (userQuery.empty)
      return next(new AppError("Usuário não encontrado", 404));
    targetUid = userQuery.docs[0].id;
    isOwner = requestUid === targetUid;
  }

  let query = db.collection("users").doc(targetUid).collection("lists");
  if (!isOwner) query = query.where("isPublic", "==", true);

  const snapshot = await query.get();
  let lists = await Promise.all(snapshot.docs.map(async (doc) => {
    const data = doc.data();
    const items = await enrichItemsIfNeeded(doc.ref, data.items || []);

    return {
      id: doc.id,
      name: data.name,
      description: data.description || "",
      items,
      savesCount: data.savesCount || 0,
      isPublic: data.isPublic,
      createdAt: data.createdAt?.toDate
        ? data.createdAt.toDate()
        : data.createdAt,
      updatedAt: data.updatedAt?.toDate
        ? data.updatedAt.toDate()
        : data.updatedAt,
    };
  }));

  lists.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  res.status(200).json(lists);
});

exports.getPublicListDetails = catchAsync(async (req, res, next) => {
  const { username, listId } = req.params;

  const userQuery = await db
    .collection("users")
    .where("username", "==", username)
    .limit(1)
    .get();
  if (userQuery.empty) return next(new AppError("Usuário não encontrado.", 404));

  const userId = userQuery.docs[0].id;
  const ownerData = userQuery.docs[0].data();

  const listDoc = await db
    .collection("users")
    .doc(userId)
    .collection("lists")
    .doc(listId)
    .get();
  if (!listDoc.exists) return next(new AppError("Lista não encontrada.", 404));

  const listData = listDoc.data();
  if (!listData.isPublic) return next(new AppError("Esta lista é privada.", 403));
  const items = await enrichItemsIfNeeded(listDoc.ref, listData.items || []);

  let clonedFrom = null;

  if (listData.clonedFrom) {
    const originalOwnerQuery = await db
      .collection("users")
      .where("username", "==", listData.clonedFrom.owner)
      .limit(1)
      .get();

    let originalOwnerPhoto = null;
    if (!originalOwnerQuery.empty) {
      originalOwnerPhoto = originalOwnerQuery.docs[0].data().photoURL || null;
    }

    clonedFrom = {
      listId: listData.clonedFrom.listId,
      owner: listData.clonedFrom.owner,
      originalName: listData.clonedFrom.originalName || listData.name,
      ownerPhoto: originalOwnerPhoto,
    };
  }

  res.status(200).json({
    id: listId,
    name: listData.name,
    description: listData.description || "",
    items,
    savesCount: listData.savesCount || 0,
    isPublic: listData.isPublic,
    createdAt: listData.createdAt?.toDate
      ? listData.createdAt.toDate()
      : listData.createdAt,
    updatedAt: listData.updatedAt?.toDate
      ? listData.updatedAt.toDate()
      : listData.updatedAt,
    clonedFrom,
    owner: {
      username: ownerData.username,
      photoURL: ownerData.photoURL || null,
      name: ownerData.name,
    },
  });
});

exports.deleteList = catchAsync(async (req, res, next) => {
  const { uid } = req.user;
  const { listId } = req.params;
  const ref = db.collection("users").doc(uid).collection("lists").doc(listId);
  const doc = await ref.get();

  if (!doc.exists) return next(new AppError("Lista não encontrada.", 404));

  await ref.delete();
  res.status(200).json({ message: "Lista deletada." });
});

exports.removeMediaFromList = catchAsync(async (req, res, next) => {
  const { uid } = req.user;
  const { listId, mediaId } = req.params;
  const listRef = db
    .collection("users")
    .doc(uid)
    .collection("lists")
    .doc(listId);
  const doc = await listRef.get();
  if (!doc.exists) return next(new AppError("Lista não encontrada.", 404));

  const currentItems = doc.data().items || [];
  const updatedItems = currentItems.filter(
    (item) => item.id.toString() !== mediaId.toString(),
  );

  await listRef.update({ items: updatedItems, updatedAt: new Date() });
  res.status(200).json({ message: "Removido." });
});

exports.shareList = catchAsync(async (req, res, next) => {
  const { uid } = req.user;
  const { listId, content } = req.body;

  const listDoc = await db
    .collection("users")
    .doc(uid)
    .collection("lists")
    .doc(listId)
    .get();
  if (!listDoc.exists) return next(new AppError("Lista não encontrada.", 404));

  const listData = listDoc.data();
  if (!listData.isPublic)
    return next(
      new AppError("Você só pode compartilhar listas públicas.", 400),
    );

  const userDoc = await db.collection("users").doc(uid).get();
  const userData = userDoc.data();

  const newShare = {
    userId: uid,
    username: userData.username,
    userPhoto: userData.photoURL || null,
    levelTitle: userData.levelTitle || "Espectador",
    listId: listId,
    listName: listData.name,
    listItems: listData.items || [],
    listCount: Array.isArray(listData.items) ? listData.items.length : 0,
    content: content || `Confira minha nova coleção: ${listData.name}`,
    type: "list_share",
    createdAt: new Date(),
    likesCount: 0,
    commentsCount: 0,
  };

  const docRef = await db.collection("shared_lists").add(newShare);
  await deleteByPrefix("feed:");
  res
    .status(201)
    .json({ id: docRef.id, message: "Coleção compartilhada com sucesso!" });
});
