const { db } = require("../../config/firebase");
const AppError = require("../../utils/AppError");

function publicUserData(uid, data = {}) {
  return {
    uid,
    username: data.username || null,
    name: data.name || data.username || "Usuario",
    photoURL: data.photoURL || null,
    levelTitle: data.levelTitle || null,
  };
}

async function getUserProfile(uid) {
  if (!uid) throw new AppError("Usuario nao informado.", 400);
  const doc = await db.collection("users").doc(uid).get();
  if (!doc.exists) throw new AppError("Usuario nao encontrado.", 404);
  return publicUserData(doc.id, doc.data());
}

async function getUserByUsername(username) {
  if (!username) throw new AppError("Usuario nao informado.", 400);
  const snapshot = await db.collection("users").where("username", "==", username).limit(1).get();
  if (snapshot.empty) throw new AppError("Usuario nao encontrado.", 404);
  const doc = snapshot.docs[0];
  return publicUserData(doc.id, doc.data());
}

async function getUsersByIds(ids) {
  const uniqueIds = [...new Set(ids.filter(Boolean))];
  if (uniqueIds.length === 0) return {};

  const refs = uniqueIds.map((uid) => db.collection("users").doc(uid));
  const docs = await db.getAll(...refs);

  return docs.reduce((map, doc) => {
    if (doc.exists) map[doc.id] = publicUserData(doc.id, doc.data());
    return map;
  }, {});
}

async function resolveMembers({ memberIds = [], memberUsernames = [] }) {
  const byId = await Promise.all((memberIds || []).map((uid) => getUserProfile(uid)));
  const byUsername = await Promise.all((memberUsernames || []).map((username) => getUserByUsername(username)));
  const map = new Map();

  [...byId, ...byUsername].forEach((user) => map.set(user.uid, user));
  return [...map.values()];
}

async function isFollowingUser(uid, targetUid) {
  if (!uid || !targetUid || uid === targetUid) return false;
  const doc = await db.collection("users").doc(uid).collection("following").doc(targetUid).get();
  return doc.exists;
}

async function ensureFollowsUser(uid, targetUid) {
  const follows = await isFollowingUser(uid, targetUid);
  if (!follows) {
    throw new AppError("Voce so pode conversar com pessoas que voce segue.", 403);
  }
}

async function ensureFollowsUsers(uid, targetUids = []) {
  const uniqueTargets = [...new Set(targetUids.filter((targetUid) => targetUid && targetUid !== uid))];
  await Promise.all(uniqueTargets.map((targetUid) => ensureFollowsUser(uid, targetUid)));
}

module.exports = {
  ensureFollowsUser,
  ensureFollowsUsers,
  getUserByUsername,
  getUserProfile,
  getUsersByIds,
  resolveMembers,
};
