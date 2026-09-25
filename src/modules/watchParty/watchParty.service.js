const AppError = require("../../shared/errors/AppError");
const { db } = require("../../config/firebase");
const repository = require("./watchParty.repository");
const runtime = require("./watchParty.runtime");

const MAX_ACTIVE_ROOMS = 1;
const MAX_QUEUE_ITEMS = 100;
const FREE_STORAGE_BYTES = 500 * 1000 * 1000;
const STORAGE_BLOCK_RATIO = 0.9;
const PROFILE_CACHE_TTL_MS = 5 * 60 * 1000;
const FOLLOWING_CACHE_TTL_MS = 60 * 1000;

async function hydrateRoom(room) {
  if (!room) return null;
  return {
    ...room,
    selectedUserIds: await repository.listAccess(room.id, "selected"),
    participants: [],
    queue: await repository.listQueue(room.id),
    messages: [],
  };
}

async function follows(userId, targetId) {
  return (
    await db
      .collection("users")
      .doc(userId)
      .collection("following")
      .doc(targetId)
      .get()
  ).exists;
}

async function getFollowingIds(userId) {
  const cached = runtime.getCached(runtime.following, userId);
  if (cached) return cached;
  const snapshot = await db
    .collection("users")
    .doc(userId)
    .collection("following")
    .get();
  const ids = snapshot.docs
    .map((document) => document.id)
    .filter((id) => id !== userId);
  runtime.setCached(runtime.following, userId, ids, FOLLOWING_CACHE_TTL_MS);
  return ids;
}

async function getFollowerIds(userId) {
  const cached = runtime.getCached(runtime.followers, userId);
  if (cached) return cached;
  const snapshot = await db
    .collection("users")
    .doc(userId)
    .collection("followers")
    .get();
  const ids = snapshot.docs
    .map((document) => document.id)
    .filter((id) => id !== userId);
  runtime.setCached(runtime.followers, userId, ids, FOLLOWING_CACHE_TTL_MS);
  return ids;
}

async function getHostProfiles(hostIds) {
  const result = new Map();
  const missing = [];
  for (const hostId of hostIds) {
    const cached = runtime.getCached(runtime.profiles, hostId);
    if (cached) result.set(hostId, cached);
    else missing.push(hostId);
  }
  if (missing.length) {
    const references = missing.map((hostId) => db.collection("users").doc(hostId));
    const snapshots = typeof db.getAll === "function"
      ? await db.getAll(...references)
      : await Promise.all(references.map((reference) => reference.get()));
    for (const snapshot of snapshots) {
      const profile = snapshot.exists ? snapshot.data() : {};
      result.set(snapshot.id, profile);
      runtime.setCached(
        runtime.profiles,
        snapshot.id,
        profile,
        PROFILE_CACHE_TTL_MS,
      );
    }
  }
  return result;
}

async function resolveSelectedUserIds(identifiers = []) {
  const unique = [...new Set(identifiers.filter(Boolean))];
  if (!unique.length) return [];
  const resolved = new Set();
  const directSnapshots = await db.getAll(
    ...unique.map((identifier) => db.collection("users").doc(identifier)),
  );
  directSnapshots.forEach((document) => {
    if (document.exists) resolved.add(document.id);
  });
  for (let index = 0; index < unique.length; index += 30) {
    const snapshot = await db
      .collection("users")
      .where("username", "in", unique.slice(index, index + 30))
      .get();
    snapshot.docs.forEach((document) => resolved.add(document.id));
  }
  return [...resolved];
}

async function assertRoomAccess(room, user, { codeEntry = false } = {}) {
  if (room.hostId === user.uid) return;
  if (await repository.hasAccess(room.id, user.uid, "blocked"))
    throw new AppError("Você foi removido desta sala.", 403);
  const selected = await repository.listAccess(room.id, "selected");
  const explicitlySelected =
    selected.includes(user.uid) ||
    (user.username && selected.includes(user.username));
  if (explicitlySelected) return;
  if (selected.length)
    throw new AppError("Esta sala foi limitada a pessoas específicas.", 403);
  if (room.privacy === "public") return;
  if (room.privacy === "invite") {
    if (codeEntry) {
      await repository.addAccess(room.id, user.uid, "admitted");
      return;
    }
    if (await repository.hasAccess(room.id, user.uid, "admitted")) return;
    throw new AppError("Entre usando o código da sala.", 403);
  }
  const allowed =
    room.privacy === "followers"
      ? await follows(user.uid, room.hostId)
      : await follows(room.hostId, user.uid);
  if (!allowed)
    throw new AppError(
      "Você não faz parte do público autorizado desta sala.",
      403,
    );
}

async function createRoom(data, user) {
  const [activeRooms, storage] = await Promise.all([
    repository.countActiveByHost(user.uid),
    repository.getStorageUsage(),
  ]);
  if (activeRooms >= MAX_ACTIVE_ROOMS)
    throw new AppError(
      "Seu perfil já possui uma sala. Exclua a sala atual antes de criar outra.",
      409,
    );
  if (storage.bytes / FREE_STORAGE_BYTES >= STORAGE_BLOCK_RATIO)
    throw new AppError(
      "Novas salas estão bloqueadas para proteger o armazenamento.",
      503,
    );
  const selectedUserIds = await resolveSelectedUserIds(data.selectedUserIds);
  return hydrateRoom(
    await repository.createRoom({ ...data, selectedUserIds, allowGuestControl: data.service === "local" && Boolean(data.allowGuestControl) }, user),
  );
}

const listMyRooms = async (userId) =>
  (await repository.listByHost(userId)).map((room) => ({
    ...room,
    isLive: runtime.isLive(room.id),
    participantCount: runtime.getParticipantCount(room.id),
  }));
async function attachHostProfiles(rooms) {
  if (!rooms.length) return [];
  const hostIds = [...new Set(rooms.map((room) => room.hostId))];
  const profiles = await getHostProfiles(hostIds);
  return rooms.map((room) => {
    const profile = profiles.get(room.hostId) || {};
    return {
      ...room,
      preview: runtime.getPreview(room.id),
      participantCount: runtime.getParticipantCount(room.id),
      host: {
        id: room.hostId,
        username: profile.username || profile.displayName || "Usuário",
        photoURL: profile.photoURL || profile.photoUrl || null,
        backgroundURL: profile.backgroundURL || null,
        bio: profile.bio || "",
      },
    };
  });
}
async function listAccessibleLiveRooms(user) {
  const rooms = await repository.listLiveByIds(runtime.getLiveRoomIds());
  const accessible = [];
  for (const room of rooms) {
    try {
      await assertRoomAccess(room, user);
      accessible.push(room);
    } catch {
      // A descoberta nunca expõe transmissões sem permissão.
    }
  }
  return attachHostProfiles(accessible);
}
async function getProfileLiveRoom(username, user) {
  const normalizedUsername = String(username || "").trim().toLowerCase();
  if (!normalizedUsername) return null;

  const profileSnapshot = await db
    .collection("users")
    .where("username", "==", normalizedUsername)
    .limit(1)
    .get();
  if (profileSnapshot.empty) return null;

  const hostId = profileSnapshot.docs[0].id;
  const rooms = await repository.listLiveByIds(runtime.getLiveRoomIds());
  const room = rooms.find((candidate) => candidate.hostId === hostId);
  if (!room) return null;

  try {
    await assertRoomAccess(room, user);
  } catch {
    // O perfil não revela nem a existência de uma live privada.
    return null;
  }

  return (await attachHostProfiles([room]))[0] || null;
}
async function listPublicRooms(userId) {
  const rooms = (await repository.listPublic(userId, runtime.getLiveRoomIds())).filter(
    (room) => room.hostId !== userId,
  );
  return attachHostProfiles(rooms);
}
async function listFollowingRooms(userId) {
  const [followingIds, followerIds] = await Promise.all([
    getFollowingIds(userId),
    getFollowerIds(userId),
  ]);
  const relatedHostIds = [...new Set([...followingIds, ...followerIds])];
  if (!relatedHostIds.length) return [];
  const rooms = await repository.listActiveByHosts(
    relatedHostIds,
    runtime.getLiveRoomIds(),
  );
  const accessible = [];
  for (const room of rooms) {
    try {
      await assertRoomAccess(room, { uid: userId });
      accessible.push(room);
    } catch {
      /* sala não autorizada */
    }
  }
  if (!accessible.length) return [];
  return attachHostProfiles(accessible);
}

async function getRoom(roomId, user) {
  const room = await repository.findById(roomId);
  if (!room || room.status !== "active")
    throw new AppError("Sala não encontrada ou encerrada.", 404);
  await assertRoomAccess(room, user);
  const enrichedRoom = (await attachHostProfiles([room]))[0] || room;
  return hydrateRoom(enrichedRoom);
}
async function joinByCode(code, user) {
  const room = await repository.findByCode(code);
  if (!room) throw new AppError("Sala não encontrada ou encerrada.", 404);
  await assertRoomAccess(room, user, { codeEntry: true });
  return hydrateRoom(room);
}
async function updateSettings(roomId, data, userId) {
  const room = await repository.findById(roomId);
  if (!room) throw new AppError("Sala não encontrada.", 404);
  if (room.hostId !== userId)
    throw new AppError("Somente o anfitrião pode alterar a sala.", 403);
  const nextService = data.service || room.service;
  const normalizedData = nextService === "local"
    ? data
    : { ...data, allowGuestControl: false };
  if (normalizedData.selectedUserIds)
    await repository.replaceSelected(
      roomId,
      await resolveSelectedUserIds(normalizedData.selectedUserIds),
    );
  runtime.touchLiveVersion();
  return hydrateRoom(await repository.updateSettings(roomId, normalizedData));
}
async function resetInviteCode(roomId, userId) {
  const room = await repository.findById(roomId);
  if (!room) throw new AppError("Sala não encontrada.", 404);
  if (room.hostId !== userId)
    throw new AppError("Somente o anfitrião pode trocar o código de convite.", 403);
  const updatedRoom = await repository.resetInviteCode(roomId);
  runtime.touchLiveVersion();
  return hydrateRoom(updatedRoom);
}
async function blockUser(roomId, targetUserId, userId) {
  const room = await repository.findById(roomId);
  if (!room || room.hostId !== userId)
    throw new AppError("Somente o anfitrião pode remover participantes.", 403);
  if (targetUserId === userId)
    throw new AppError("O anfitrião não pode remover a si mesmo.", 400);
  await repository.addAccess(roomId, targetUserId, "blocked");
}
async function addQueueItem(roomId, data, user) {
  await getRoom(roomId, user);
  if ((await repository.countQueueItems(roomId)) >= MAX_QUEUE_ITEMS)
    throw new AppError("A fila atingiu o limite de 100 itens.", 409);
  return repository.addQueueItem(roomId, data, user.uid);
}
async function deleteRoom(roomId, userId) {
  const room = await repository.findById(roomId);
  if (!room) throw new AppError("Sala não encontrada.", 404);
  if (room.hostId !== userId)
    throw new AppError("Somente o anfitrião pode excluir a sala.", 403);
  await repository.deleteRoom(roomId);
  runtime.setLive(roomId, false);
  runtime.events.emit("room-deleted", roomId);
}
const getLiveVersion = () => ({ version: runtime.getLiveVersion() });
async function canControlRoom(roomId, userId) {
  const room = await repository.findById(roomId);
  return Boolean(room && (room.hostId === userId || room.allowGuestControl));
}
async function getStorageStatus(user) {
  if (user.role !== "admin") throw new AppError("Acesso restrito.", 403);
  const { bytes } = await repository.getStorageUsage();
  const ratio = bytes / FREE_STORAGE_BYTES;
  return {
    bytes,
    limitBytes: FREE_STORAGE_BYTES,
    percentage: Number((ratio * 100).toFixed(2)),
    level:
      ratio >= 0.9
        ? "critical"
        : ratio >= 0.75
          ? "warning"
          : ratio >= 0.6
            ? "attention"
            : "normal",
    createRoomsBlocked: ratio >= STORAGE_BLOCK_RATIO,
  };
}

module.exports = {
  createRoom,
  listMyRooms,
  listPublicRooms,
  listFollowingRooms,
  listAccessibleLiveRooms,
  getProfileLiveRoom,
  getRoom,
  joinByCode,
  updateSettings,
  resetInviteCode,
  blockUser,
  deleteRoom,
  canControlRoom,
  addQueueItem,
  getStorageStatus,
  getLiveVersion,
};
