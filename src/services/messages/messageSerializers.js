const { decryptText } = require("../messageCrypto");

function normalizeMedia(media) {
  if (!media) return null;

  return {
    id: String(media.mediaId || media.id),
    mediaType: media.mediaType || "movie",
    title: media.title,
    posterPath: media.posterPath || media.poster_path || null,
    backdropPath: media.backdropPath || media.backdrop_path || null,
    voteAverage: media.voteAverage ?? media.vote_average ?? null,
    releaseDate: media.releaseDate || media.release_date || null,
    firstAirDate: media.firstAirDate || media.first_air_date || null,
    note: media.note || null,
  };
}

function storagePreview(message) {
  if (!message) return "";
  if (message.media?.title) return `enviou um card: ${message.media.title}`;
  return "Nova mensagem";
}

function serializeMember(memberId, profile = {}, uid) {
  return {
    isSelf: memberId === uid,
    username: profile.username || null,
    name: profile.name || profile.username || "Usuario",
    photoURL: profile.photoURL || null,
    levelTitle: profile.levelTitle || null,
  };
}

function serializeLastMessage(lastMessage = null) {
  if (!lastMessage) return null;

  return {
    messageId: lastMessage.messageId || null,
    preview: lastMessage.encryptedText ? decryptText(lastMessage.encryptedText) : lastMessage.preview || "",
    senderName: lastMessage.senderName || null,
    senderPhoto: lastMessage.senderPhoto || null,
    createdAt: lastMessage.createdAt || null,
    type: lastMessage.type || null,
    mediaTitle: lastMessage.mediaTitle || null,
    system: lastMessage.system || false,
  };
}

function getUserClearTimestamp(conversation, uid) {
  return Number(conversation.memberMeta?.[uid]?.clearedAt || 0);
}

function getVisibleLastMessage(conversation, uid) {
  const lastMessage = conversation.lastMessage || null;
  if (!lastMessage) return null;

  const clearedAt = getUserClearTimestamp(conversation, uid);
  if (clearedAt && Number(lastMessage.createdAt || 0) <= clearedAt) return null;

  return lastMessage;
}

function serializeMessage(message, uid) {
  return {
    id: message.id,
    conversationId: message.conversationId,
    senderUsername: message.senderUsername || null,
    senderPhoto: message.senderPhoto || null,
    isMine: message.senderId === uid,
    type: message.type || (message.media ? "media" : "text"),
    text: message.encryptedText ? decryptText(message.encryptedText) : message.text || "",
    media: message.media || null,
    createdAt: message.createdAt || null,
    editedAt: message.editedAt || null,
    deletedAt: message.deletedAt || null,
  };
}

function conversationTitleForUser(conversation, profiles, uid) {
  if (conversation.type === "group") return conversation.name || "Grupo";

  const otherUid = Object.keys(conversation.members || {}).find((memberId) => memberId !== uid);
  const other = profiles[otherUid] || {};
  return other.name || other.username || "Conversa";
}

function serializeConversation(conversation, userIndex = {}, profiles = {}, uid) {
  const memberIds = Object.keys(conversation.members || {});
  const members = memberIds.map((memberId) => serializeMember(memberId, profiles[memberId] || {}, uid));
  const lastMessage = serializeLastMessage(getVisibleLastMessage(conversation, uid));

  return {
    id: conversation.id,
    type: conversation.type,
    name: conversationTitleForUser(conversation, profiles, uid),
    groupName: conversation.name || null,
    photoURL: conversation.photoURL || null,
    members,
    memberCount: memberIds.length,
    isOwner: conversation.createdBy === uid,
    createdAt: conversation.createdAt || null,
    updatedAt: conversation.updatedAt || null,
    hidden: Boolean(conversation.hidden),
    lastMessage,
    lastMessagePreview: lastMessage?.preview || userIndex.lastMessagePreview || "",
    unreadCount: userIndex.unreadCount || 0,
  };
}

module.exports = {
  conversationTitleForUser,
  getUserClearTimestamp,
  getVisibleLastMessage,
  normalizeMedia,
  serializeConversation,
  serializeLastMessage,
  serializeMessage,
  storagePreview,
};
