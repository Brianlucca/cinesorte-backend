const { WebSocketServer, WebSocket } = require("ws");
const { randomUUID } = require("crypto");
const { auth, db } = require("../../config/firebase");
const env = require("../../config/env");
const {
  AUTH_COOKIE_NAME,
  LEGACY_AUTH_COOKIE_NAME,
} = require("../../config/cookies");
const service = require("./watchParty.service");
const logger = require("../../shared/utils/logger");
const runtime = require("./watchParty.runtime");

const SIGNAL_TYPES = new Set([
  "host-ready",
  "viewer-ready",
  "offer",
  "answer",
  "ice-candidate",
  "stream-stopped",
  "playback-control",
  "media-metadata",
]);
const rooms = new Map();
const roomMedia = new Map();
const roomMessages = new Map();
const MESSAGE_TTL_MS = 60 * 1000;
const MAX_MESSAGE_LENGTH = 500;
const MAX_MESSAGES_PER_ROOM = 200;
const MESSAGE_COOLDOWN_MS = 500;

const parseCookies = (header = "") =>
  Object.fromEntries(
    header
      .split(";")
      .map((part) => {
        const separator = part.indexOf("=");
        if (separator < 1) return null;
        return [
          part.slice(0, separator).trim(),
          decodeURIComponent(part.slice(separator + 1).trim()),
        ];
      })
      .filter(Boolean),
  );

async function authenticate(request) {
  const cookies = parseCookies(request.headers.cookie);
  const sessionCookie =
    cookies[AUTH_COOKIE_NAME] || cookies[LEGACY_AUTH_COOKIE_NAME];
  if (!sessionCookie) throw new Error("Sessão ausente.");
  const claims = await auth.verifySessionCookie(sessionCookie, true);
  if (!claims.email_verified) throw new Error("Email não verificado.");
  const userDoc = await db.collection("users").doc(claims.uid).get();
  if (!userDoc.exists) throw new Error("Usuário não encontrado.");
  const user = userDoc.data();
  return { uid: claims.uid, username: user.username, photoURL: user.photoURL };
}

function broadcast(roomId, payload, excludedSocket = null) {
  const members = rooms.get(roomId);
  if (!members) return;
  const serialized = JSON.stringify(payload);
  members.forEach((socket) => {
    if (socket !== excludedSocket && socket.readyState === WebSocket.OPEN)
      socket.send(serialized);
  });
}

function sendTo(roomId, connectionId, payload) {
  const target = [...(rooms.get(roomId) || [])].find(
    (member) => member.connectionId === connectionId,
  );
  if (target?.readyState === WebSocket.OPEN)
    target.send(JSON.stringify(payload));
}

function broadcastPresence(roomId) {
  const participants = [];
  const seenUsers = new Set();
  for (const member of rooms.get(roomId) || []) {
    if (seenUsers.has(member.user.uid)) continue;
    seenUsers.add(member.user.uid);
    participants.push({
      id: member.user.uid,
      username: member.user.username,
      name: member.user.username || "Usuário",
      photoURL: member.user.photoURL || null,
      role: member.isHost ? "host" : "viewer",
      online: true,
    });
  }
  broadcast(roomId, { type: "presence", payload: { participants } });
}

function removeSocket(roomId, socket) {
  const members = rooms.get(roomId);
  if (!members) return;
  members.delete(socket);
  if (
    socket.isStreaming &&
    ![...members].some((member) => member.isHost && member.isStreaming)
  )
    runtime.setLive(roomId, false);
  if (members.size === 0) {
    rooms.delete(roomId);
    roomMessages.delete(roomId);
    roomMedia.delete(roomId);
    runtime.deletePreview(roomId);
  } else broadcastPresence(roomId);
}

function registerWatchPartyGateway(server) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
  const closeDeletedRoom = (roomId) => {
    const members = [...(rooms.get(roomId) || [])];
    broadcast(roomId, { type: "room-deleted", payload: { roomId } });
    members.forEach((member) => member.close(4004, "Room deleted"));
    rooms.delete(roomId);
    roomMessages.delete(roomId);
    roomMedia.delete(roomId);
    runtime.deletePreview(roomId);
  };
  runtime.events.on("room-deleted", closeDeletedRoom);

  const heartbeat = setInterval(() => {
    wss.clients.forEach((socket) => {
      if (socket.isAlive === false) {
        socket.terminate();
        return;
      }
      socket.isAlive = false;
      socket.ping();
    });
  }, 25000);
  heartbeat.unref();
  wss.on("close", () => {
    clearInterval(heartbeat);
    runtime.events.off("room-deleted", closeDeletedRoom);
  });

  server.on("upgrade", async (request, socket, head) => {
    try {
      const url = new URL(request.url, `http://${request.headers.host}`);
      if (url.pathname !== "/api/watch-party/ws") {
        socket.destroy();
        return;
      }
      if (
        request.headers.origin &&
        request.headers.origin.replace(/\/$/, "") !==
          env.FRONTEND_URL.replace(/\/$/, "")
      )
        throw new Error("Origem não permitida.");
      const roomId = url.searchParams.get("roomId");
      if (!roomId) throw new Error("Sala ausente.");
      const user = await authenticate(request);
      const room = await service.getRoom(roomId, user);
      wss.handleUpgrade(request, socket, head, (webSocket) => {
        webSocket.user = user;
        webSocket.roomId = roomId;
        webSocket.connectionId = randomUUID();
        webSocket.canControl =
          room.hostId === user.uid || room.allowGuestControl;
        webSocket.isHost = room.hostId === user.uid;
        wss.emit("connection", webSocket);
      });
    } catch (error) {
      logger.warn("watch_party_ws_rejected", { message: error.message });
      socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      socket.destroy();
    }
  });

  wss.on("connection", (socket) => {
    const { roomId, user } = socket;
    if (!rooms.has(roomId)) rooms.set(roomId, new Set());
    rooms.get(roomId).add(socket);
    socket.isAlive = true;
    socket.on("pong", () => { socket.isAlive = true; });
    socket.send(
      JSON.stringify({
        type: "connected",
        payload: { userId: user.uid, connectionId: socket.connectionId },
      }),
    );
    socket.send(
      JSON.stringify({
        type: "chat-history",
        payload: { messages: roomMessages.get(roomId) || [] },
      }),
    );
    if (roomMedia.has(roomId))
      socket.send(
        JSON.stringify({
          type: "media-metadata",
          payload: roomMedia.get(roomId),
        }),
      );
    broadcastPresence(roomId);

    socket.on("message", async (rawMessage) => {
      try {
        const message = JSON.parse(rawMessage.toString());
        if (message.type === "chat-message") {
          if (Date.now() - (socket.lastChatAt || 0) < MESSAGE_COOLDOWN_MS)
            return;
          const body = String(message.payload?.body || "")
            .trim()
            .slice(0, MAX_MESSAGE_LENGTH);
          if (!body) return;
          socket.lastChatAt = Date.now();
          const chatMessage = {
            id: randomUUID(),
            senderId: user.uid,
            senderName: user.username || "Usuário",
            body,
            createdAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + MESSAGE_TTL_MS).toISOString(),
          };
          const messages = roomMessages.get(roomId) || [];
          roomMessages.set(
            roomId,
            [...messages, chatMessage].slice(-MAX_MESSAGES_PER_ROOM),
          );
          broadcast(roomId, { type: "chat-message", payload: chatMessage });
          setTimeout(() => {
            if (!roomMessages.has(roomId)) return;
            const current = roomMessages.get(roomId) || [];
            roomMessages.set(
              roomId,
              current.filter((item) => item.id !== chatMessage.id),
            );
            broadcast(roomId, {
              type: "chat-expired",
              payload: { id: chatMessage.id },
            });
          }, MESSAGE_TTL_MS).unref();
          return;
        }
        if (message.type === "kick-user") {
          if (!socket.isHost) return;
          const targetUserId = String(message.payload?.userId || "");
          if (!targetUserId || targetUserId === user.uid) return;
          await service.blockUser(roomId, targetUserId, user.uid);
          for (const member of rooms.get(roomId) || []) {
            if (member.user.uid === targetUserId) {
              member.send(
                JSON.stringify({
                  type: "kicked",
                  payload: { message: "Você foi removido desta sala." },
                }),
              );
              member.close(4003, "Removed by host");
            }
          }
          return;
        }
        if (message.type === "playback-control") {
          if (
            !socket.canControl &&
            !(await service.canControlRoom(roomId, user.uid))
          )
            return;
          const action = message.payload?.action;
          const position = Number(message.payload?.position);
          if (!["play", "pause", "seek-relative"].includes(action)) return;
          message.payload = {
            action,
            ...(action === "seek-relative" && Number.isFinite(position)
              ? { position: Math.max(-600, Math.min(600, position)) }
              : {}),
          };
        }
        if (message.type === "media-metadata") {
          if (!socket.isHost) return;
          const title = String(message.payload?.title || "")
            .trim()
            .slice(0, 180);
          if (!title) return;
          message.payload = { title };
          roomMedia.set(roomId, message.payload);
        }
        if (message.type === "room-preview") {
          if (!socket.isHost) return;
          const image = String(message.payload?.image || "");
          if (
            !image.startsWith("data:image/jpeg;base64,") ||
            image.length > 60 * 1024
          )
            return;
          runtime.setPreview(roomId, { image });
          return;
        }
        if (!SIGNAL_TYPES.has(message.type)) return;
        if (message.type === "host-ready") {
          if (!socket.isHost) return;
          socket.isStreaming = true;
          runtime.setLive(roomId, true);
        }
        if (message.type === "stream-stopped") {
          if (!socket.isHost) return;
          socket.isStreaming = false;
          runtime.setLive(roomId, false);
        }
        const outgoing = {
          type: message.type,
          payload: message.payload || {},
          senderId: socket.connectionId,
          userId: user.uid,
        };
        if (message.targetId) sendTo(roomId, message.targetId, outgoing);
        else broadcast(roomId, outgoing, socket);
      } catch (error) {
        logger.warn("watch_party_ws_invalid_message", {
          userId: user.uid,
          message: error.message,
        });
      }
    });
    socket.on("close", () => removeSocket(roomId, socket));
    socket.on("error", () => removeSocket(roomId, socket));
  });

  return wss;
}

module.exports = { registerWatchPartyGateway };
