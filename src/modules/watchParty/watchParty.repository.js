const { getPool, query } = require("../../config/postgres");

const roomSelect = `SELECT id, code, name, service, privacy, allow_guest_control AS "allowGuestControl", host_id AS "hostId", status, playback, created_at AS "createdAt", updated_at AS "updatedAt" FROM watch_party_rooms`;
const generateCode = () => Math.random().toString(36).slice(2, 8).toUpperCase();

async function createRoom(data, user) {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    let room;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        const result = await client.query(
          `INSERT INTO watch_party_rooms (code, name, service, privacy, allow_guest_control, host_id) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, code, name, service, privacy, allow_guest_control AS "allowGuestControl", host_id AS "hostId", status, playback, created_at AS "createdAt", updated_at AS "updatedAt"`,
          [
            generateCode(),
            data.name,
            data.service,
            data.privacy,
            data.allowGuestControl,
            user.uid,
          ],
        );
        room = result.rows[0];
        if (data.selectedUserIds?.length) {
          await client.query(
            `INSERT INTO watch_party_access (room_id, user_id, kind) SELECT $1, unnest($2::text[]), 'selected' ON CONFLICT DO NOTHING`,
            [room.id, data.selectedUserIds],
          );
        }
        break;
      } catch (error) {
        if (error.code !== "23505" || attempt === 4) throw error;
      }
    }
    await client.query("COMMIT");
    return room;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

const listByHost = async (hostId) =>
  (
    await query(`${roomSelect} WHERE host_id = $1 ORDER BY updated_at DESC`, [
      hostId,
    ])
  ).rows;
const listPublic = async (userId) =>
  (
    await query(
      `${roomSelect} WHERE privacy = 'public' AND status = 'active' AND NOT EXISTS (SELECT 1 FROM watch_party_access access WHERE access.room_id = watch_party_rooms.id AND access.user_id = $1 AND access.kind = 'blocked') ORDER BY updated_at DESC LIMIT 40`,
      [userId],
    )
  ).rows;
const countActiveByHost = async (hostId) =>
  Number(
    (
      await query(
        `SELECT COUNT(*)::int AS count FROM watch_party_rooms WHERE host_id = $1 AND status = 'active'`,
        [hostId],
      )
    ).rows[0]?.count || 0,
  );
const listActiveByHosts = async (hostIds) => {
  if (!hostIds.length) return [];
  return (
    await query(
      `SELECT room.id, room.code, room.name, room.service, room.privacy, room.allow_guest_control AS "allowGuestControl", room.host_id AS "hostId", room.status, room.playback, room.created_at AS "createdAt", room.updated_at AS "updatedAt", 0 AS "participantCount" FROM watch_party_rooms room WHERE room.host_id = ANY($1::text[]) AND room.privacy IN ('public', 'following') AND room.status = 'active' ORDER BY room.updated_at DESC LIMIT 30`,
      [hostIds],
    )
  ).rows;
};
const findById = async (roomId) =>
  (await query(`${roomSelect} WHERE id = $1 LIMIT 1`, [roomId])).rows[0] ||
  null;
const findByCode = async (code) =>
  (
    await query(`${roomSelect} WHERE code = $1 AND status = 'active' LIMIT 1`, [
      code,
    ])
  ).rows[0] || null;
const updateSettings = async (roomId, data) =>
  (
    await query(
      `UPDATE watch_party_rooms SET privacy = COALESCE($2, privacy), allow_guest_control = COALESCE($3, allow_guest_control), updated_at = NOW() WHERE id = $1 RETURNING id, code, name, service, privacy, allow_guest_control AS "allowGuestControl", host_id AS "hostId", status, playback, created_at AS "createdAt", updated_at AS "updatedAt"`,
      [roomId, data.privacy ?? null, data.allowGuestControl ?? null],
    )
  ).rows[0] || null;
const deleteRoom = async (roomId) =>
  (
    await query(`DELETE FROM watch_party_rooms WHERE id = $1 RETURNING id`, [
      roomId,
    ])
  ).rows[0] || null;
const listAccess = async (roomId, kind) =>
  (
    await query(
      `SELECT user_id AS "userId" FROM watch_party_access WHERE room_id = $1 AND kind = $2`,
      [roomId, kind],
    )
  ).rows.map((row) => row.userId);
const hasAccess = async (roomId, userId, kind) =>
  Boolean(
    (
      await query(
        `SELECT 1 FROM watch_party_access WHERE room_id = $1 AND user_id = $2 AND kind = $3 LIMIT 1`,
        [roomId, userId, kind],
      )
    ).rowCount,
  );
const addAccess = async (roomId, userId, kind) =>
  query(
    `INSERT INTO watch_party_access (room_id, user_id, kind) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
    [roomId, userId, kind],
  );
async function replaceSelected(roomId, userIds) {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `DELETE FROM watch_party_access WHERE room_id = $1 AND kind = 'selected'`,
      [roomId],
    );
    if (userIds.length)
      await client.query(
        `INSERT INTO watch_party_access (room_id, user_id, kind) SELECT $1, unnest($2::text[]), 'selected'`,
        [roomId, userIds],
      );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
async function addQueueItem(roomId, item, userId) {
  return (
    await query(
      `INSERT INTO watch_party_queue (room_id, video_id, title, thumbnail, added_by, position) VALUES ($1, $2, $3, $4, $5, COALESCE((SELECT MAX(position) + 1 FROM watch_party_queue WHERE room_id = $1), 0)) RETURNING id, video_id AS "videoId", title, thumbnail, added_by AS "addedBy", position, created_at AS "createdAt"`,
      [roomId, item.videoId, item.title, item.thumbnail || null, userId],
    )
  ).rows[0];
}
const countQueueItems = async (roomId) =>
  Number(
    (
      await query(
        `SELECT COUNT(*)::int AS count FROM watch_party_queue WHERE room_id = $1`,
        [roomId],
      )
    ).rows[0]?.count || 0,
  );
const listQueue = async (roomId) =>
  (
    await query(
      `SELECT id, video_id AS "videoId", title, thumbnail, added_by AS "addedBy", position, created_at AS "createdAt" FROM watch_party_queue WHERE room_id = $1 ORDER BY position ASC`,
      [roomId],
    )
  ).rows;
const addMessage = async (roomId, user, body) =>
  (
    await query(
      `INSERT INTO watch_party_messages (room_id, sender_id, sender_name, sender_username, body) VALUES ($1, $2, $3, $4, $5) RETURNING id, sender_id AS "senderId", sender_name AS "senderName", sender_username AS "senderUsername", body, created_at AS "createdAt"`,
      [
        roomId,
        user.uid,
        user.username || "Usuário",
        user.username || null,
        body,
      ],
    )
  ).rows[0];
const listMessages = async (roomId) =>
  (
    await query(
      `SELECT id, sender_id AS "senderId", sender_name AS "senderName", sender_username AS "senderUsername", body, created_at AS "createdAt" FROM watch_party_messages WHERE room_id = $1 ORDER BY created_at ASC LIMIT 200`,
      [roomId],
    )
  ).rows;

const getStorageUsage = async () => {
  const bytes = Number(
    (
      await query(
        `SELECT pg_database_size(current_database())::bigint AS bytes`,
      )
    ).rows[0]?.bytes || 0,
  );
  return { bytes };
};

module.exports = {
  createRoom,
  listByHost,
  listPublic,
  countActiveByHost,
  listActiveByHosts,
  findById,
  findByCode,
  updateSettings,
  deleteRoom,
  listAccess,
  hasAccess,
  addAccess,
  replaceSelected,
  addQueueItem,
  countQueueItems,
  listQueue,
  getStorageUsage,
};
