const { rtdb, admin } = require("../../config/firebase");
const { encryptText } = require("./messageCrypto.service");
const AppError = require("../../shared/errors/AppError");
const {
  CONVERSATIONS_PATH,
  DIRECT_PAIRS_PATH,
  GROUPS_BY_OWNER_PATH,
  HIDDEN_GROUPS_BY_USER_PATH,
  LEGACY_PATHS,
  MESSAGES_PATH,
  USER_CONVERSATIONS_PATH,
  directPairKey,
  firstExistingSnapshot,
  isMissingIndexError,
  messagesPath,
  userConversationsPath,
} = require("./messagePaths");
const {
  ensureFollowsUser,
  ensureFollowsUsers,
  getUserByUsername,
  getUserProfile,
  getUsersByIds,
  resolveMembers,
} = require("./messageUsers");
const {
  conversationTitleForUser,
  getUserClearTimestamp,
  getVisibleLastMessage,
  normalizeMedia,
  serializeConversation,
  serializeLastMessage,
  serializeMessage,
  storagePreview,
} = require("./messageSerializers");

const MAX_GROUP_MEMBERS = 30;
const MAX_CONVERSATIONS = 50;
const MAX_MESSAGES = 60;

async function getConversationOrFail(conversationId, uid) {
  const { snapshot, path } = await firstExistingSnapshot([
    `${CONVERSATIONS_PATH}/${conversationId}`,
    `${LEGACY_PATHS.conversations}/${conversationId}`,
  ]);
  if (!snapshot || !snapshot.exists()) throw new AppError("Conversa não encontrada.", 404);

  const conversation = snapshot.val();
  if (!conversation.members?.[uid]) throw new AppError("Voce não participa desta conversa.", 403);

  return { id: conversationId, storagePath: path, isLegacy: path.startsWith(LEGACY_PATHS.conversations), ...conversation };
}

async function getUserConversationIndex(uid) {
  const loadIndex = async (basePath) => {
    const ref = rtdb.ref(`${basePath}/${uid}`);

    try {
      const snapshot = await ref.orderByChild("updatedAt").limitToLast(MAX_CONVERSATIONS).get();
      return snapshot.val() || {};
    } catch (error) {
      if (!isMissingIndexError(error)) throw error;
      const snapshot = await ref.get();
      const allItems = Object.entries(snapshot.val() || {})
        .map(([conversationId, data]) => ({ conversationId, ...data }))
        .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
        .slice(0, MAX_CONVERSATIONS);

      return allItems.reduce((acc, item) => {
        const { conversationId, ...data } = item;
        acc[conversationId] = data;
        return acc;
      }, {});
    }
  };

  const [currentIndex, legacyIndex] = await Promise.all([
    loadIndex(USER_CONVERSATIONS_PATH),
    loadIndex(LEGACY_PATHS.userConversations),
  ]);

  return { ...legacyIndex, ...currentIndex };
}

async function listConversations(uid) {
  const index = await getUserConversationIndex(uid);
  const ordered = Object.entries(index)
    .map(([conversationId, data]) => ({ conversationId, ...data }))
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

  if (ordered.length === 0) return [];

  const conversationSnapshots = await Promise.all(
    ordered.map((item) =>
      firstExistingSnapshot([
        `${CONVERSATIONS_PATH}/${item.conversationId}`,
        `${LEGACY_PATHS.conversations}/${item.conversationId}`,
      ])
    )
  );

  const conversations = conversationSnapshots
    .map(({ snapshot, path }, indexPosition) =>
      snapshot?.exists()
        ? { id: ordered[indexPosition].conversationId, storagePath: path, ...snapshot.val() }
        : null
    )
    .filter(Boolean)
    .filter((conversation) => conversation.members?.[uid]);

  const allMemberIds = conversations.flatMap((conversation) => Object.keys(conversation.members || {}));
  const profiles = await getUsersByIds(allMemberIds);

  return conversations.map((conversation) =>
    serializeConversation(conversation, index[conversation.id] || {}, profiles, uid)
  );
}

async function createDirectConversation(currentUser, { targetUserId, targetUsername }) {
  const target = targetUserId ? await getUserProfile(targetUserId) : await getUserByUsername(targetUsername);
  if (target.uid === currentUser.uid) throw new AppError("Voce não pode abrir conversa consigo mesmo.", 400);
  await ensureFollowsUser(currentUser.uid, target.uid);

  const now = Date.now();
  const pairKey = directPairKey(currentUser.uid, target.uid);
  const { snapshot: pairSnapshot } = await firstExistingSnapshot([
    `${DIRECT_PAIRS_PATH}/${pairKey}`,
    `${LEGACY_PATHS.directPairs}/${pairKey}`,
  ]);
  const conversationId = pairSnapshot?.exists() ? pairSnapshot.val().conversationId : rtdb.ref(CONVERSATIONS_PATH).push().key;
  const { snapshot, path: conversationPath } = await firstExistingSnapshot([
    `${CONVERSATIONS_PATH}/${conversationId}`,
    `${LEGACY_PATHS.conversations}/${conversationId}`,
  ]);

  if (!snapshot?.exists()) {
    const members = {
      [currentUser.uid]: true,
      [target.uid]: true,
    };
    const conversation = {
      type: "direct",
      members,
      memberMeta: {
        [currentUser.uid]: { joinedAt: now, lastReadAt: now },
        [target.uid]: { joinedAt: now, lastReadAt: now },
      },
      createdBy: currentUser.uid,
      createdAt: now,
      updatedAt: now,
      lastMessage: null,
    };

    await rtdb.ref().update({
      [`${DIRECT_PAIRS_PATH}/${pairKey}`]: {
        conversationId,
        createdAt: now,
        members: {
          [currentUser.uid]: true,
          [target.uid]: true,
        },
      },
      [`${CONVERSATIONS_PATH}/${conversationId}`]: conversation,
      [`${USER_CONVERSATIONS_PATH}/${currentUser.uid}/${conversationId}`]: {
        conversationId,
        updatedAt: now,
        unreadCount: 0,
        lastMessagePreview: "",
      },
      [`${USER_CONVERSATIONS_PATH}/${target.uid}/${conversationId}`]: {
        conversationId,
        updatedAt: now,
        unreadCount: 0,
        lastMessagePreview: "",
      },
    });
  }

  const conversationSnapshot = snapshot?.exists()
    ? snapshot
    : await rtdb.ref(`${CONVERSATIONS_PATH}/${conversationId}`).get();
  const conversation = conversationSnapshot.val();
  const isLegacy = conversationPath?.startsWith(LEGACY_PATHS.conversations);
  const conversationBasePath = isLegacy ? `${LEGACY_PATHS.conversations}/${conversationId}` : `${CONVERSATIONS_PATH}/${conversationId}`;
  const userIndexBasePath = userConversationsPath(isLegacy);
  const profiles = await getUsersByIds(Object.keys(conversation.members || {}));
  const userIndexRef = rtdb.ref(`${userIndexBasePath}/${currentUser.uid}/${conversationId}`);
  const userIndexSnapshot = await userIndexRef.get();
  let userIndex = userIndexSnapshot.val() || {};

  if (snapshot?.exists() && !userIndexSnapshot.exists()) {
    const visibleLastMessage = getVisibleLastMessage(conversation, currentUser.uid);
    const lastMessage = serializeLastMessage(visibleLastMessage);
    userIndex = {
      conversationId,
      updatedAt: visibleLastMessage?.createdAt || now,
      unreadCount: 0,
      lastMessagePreview: lastMessage?.preview || "",
    };
    await rtdb.ref().update({
      [`${userIndexBasePath}/${currentUser.uid}/${conversationId}`]: userIndex,
      [`${conversationBasePath}/memberMeta/${currentUser.uid}/hiddenAt`]: null,
    });
  }

  return serializeConversation({ id: conversationId, ...conversation }, userIndex, profiles, currentUser.uid);
}

async function createGroupConversation(currentUser, { name, memberIds = [], memberUsernames = [], photoURL = null }) {
  const resolvedMembers = await resolveMembers({ memberIds, memberUsernames });
  const membersMap = new Map(resolvedMembers.map((member) => [member.uid, member]));
  membersMap.set(currentUser.uid, await getUserProfile(currentUser.uid));

  const members = [...membersMap.values()];
  if (members.length < 2) throw new AppError("Grupo precisa ter pelo menos 2 participantes.", 400);
  if (members.length > MAX_GROUP_MEMBERS) throw new AppError("Grupo excede o limite de participantes.", 400);
  await ensureFollowsUsers(currentUser.uid, members.map((member) => member.uid));

  const now = Date.now();
  const conversationRef = rtdb.ref(CONVERSATIONS_PATH).push();
  const conversationId = conversationRef.key;
  const membersObject = members.reduce((acc, member) => {
    acc[member.uid] = true;
    return acc;
  }, {});
  const memberMeta = members.reduce((acc, member) => {
    acc[member.uid] = { joinedAt: now, lastReadAt: now };
    return acc;
  }, {});

  const conversation = {
    type: "group",
    name,
    photoURL: photoURL || null,
    members: membersObject,
    memberMeta,
    createdBy: currentUser.uid,
    createdAt: now,
    updatedAt: now,
    lastMessage: {
      preview: `${currentUser.username || "Alguem"} criou o grupo.`,
      senderId: currentUser.uid,
      senderName: currentUser.username || null,
      createdAt: now,
      system: true,
    },
  };

  const updates = {
    [`${CONVERSATIONS_PATH}/${conversationId}`]: conversation,
    [`${GROUPS_BY_OWNER_PATH}/${currentUser.uid}/${conversationId}`]: {
      conversationId,
      name,
      createdAt: now,
      updatedAt: now,
    },
  };

  members.forEach((member) => {
    updates[`${USER_CONVERSATIONS_PATH}/${member.uid}/${conversationId}`] = {
      conversationId,
      updatedAt: now,
      unreadCount: member.uid === currentUser.uid ? 0 : 1,
      lastMessagePreview: conversation.lastMessage.preview,
    };
  });

  await rtdb.ref().update(updates);
  const profiles = await getUsersByIds(members.map((member) => member.uid));
  return serializeConversation({ id: conversationId, ...conversation }, updates[`${USER_CONVERSATIONS_PATH}/${currentUser.uid}/${conversationId}`], profiles, currentUser.uid);
}

async function getMessages(uid, conversationId, { limit = 30, before = null } = {}) {
  const conversation = await getConversationOrFail(conversationId, uid);
  const safeLimit = Math.min(Math.max(Number(limit) || 30, 1), MAX_MESSAGES);
  const ref = rtdb.ref(`${messagesPath(conversation.isLegacy)}/${conversationId}`);
  let query = ref.orderByChild("createdAt");

  if (before) query = query.endAt(Number(before) - 1);

  let rawMessages;
  try {
    const snapshot = await query.limitToLast(safeLimit).get();
    rawMessages = snapshot.val() || {};
  } catch (error) {
    if (!isMissingIndexError(error)) throw error;
    const snapshot = await ref.get();
    rawMessages = snapshot.val() || {};
  }

  const messages = Object.entries(rawMessages)
    .map(([messageId, message]) => ({ id: messageId, ...message }))
    .filter((message) => (message.createdAt || 0) > getUserClearTimestamp(conversation, uid))
    .filter((message) => !before || (message.createdAt || 0) < Number(before))
    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
    .slice(-safeLimit)
    .map((message) => serializeMessage(message, uid));

  return messages;
}

async function sendMessage(currentUser, conversationId, { text = "", media = null }) {
  const conversation = await getConversationOrFail(conversationId, currentUser.uid);

  const now = Date.now();
  const normalizedMedia = normalizeMedia(media);
  const encryptedText = text ? encryptText(text) : null;
  const conversationBasePath = conversation.storagePath || `${CONVERSATIONS_PATH}/${conversationId}`;
  const userIndexBasePath = userConversationsPath(conversation.isLegacy);
  const messageBasePath = messagesPath(conversation.isLegacy);
  const messageRef = rtdb.ref(`${messageBasePath}/${conversationId}`).push();
  const messageId = messageRef.key;
  const message = {
    id: messageId,
    conversationId,
    senderId: currentUser.uid,
    senderUsername: currentUser.username || null,
    senderPhoto: currentUser.photoURL || null,
    type: normalizedMedia ? "media" : "text",
    text: encryptedText ? "" : text || "",
    encryptedText,
    media: normalizedMedia,
    createdAt: now,
    editedAt: null,
    deletedAt: null,
  };
  const safePreview = storagePreview(message);
  const lastMessage = {
    messageId,
    preview: safePreview,
    encryptedText,
    senderName: currentUser.username || "Usuario",
    senderPhoto: currentUser.photoURL || null,
    createdAt: now,
    type: message.type,
    mediaTitle: normalizedMedia?.title || null,
  };
  const memberIds = Object.keys(conversation.members || {});
  const updates = {
    [`${messageBasePath}/${conversationId}/${messageId}`]: message,
    [`${conversationBasePath}/updatedAt`]: now,
    [`${conversationBasePath}/lastMessage`]: lastMessage,
    [`${conversationBasePath}/memberMeta/${currentUser.uid}/lastReadAt`]: now,
  };

  memberIds.forEach((memberId) => {
    updates[`${userIndexBasePath}/${memberId}/${conversationId}/conversationId`] = conversationId;
    updates[`${userIndexBasePath}/${memberId}/${conversationId}/updatedAt`] = now;
    updates[`${userIndexBasePath}/${memberId}/${conversationId}/lastMessagePreview`] = safePreview;

    if (memberId === currentUser.uid) {
      updates[`${userIndexBasePath}/${memberId}/${conversationId}/unreadCount`] = 0;
    } else {
      updates[`${userIndexBasePath}/${memberId}/${conversationId}/unreadCount`] = admin.database.ServerValue.increment(1);
    }
  });

  await rtdb.ref().update(updates);
  return serializeMessage(message, currentUser.uid);
}

async function markConversationRead(uid, conversationId) {
  const conversation = await getConversationOrFail(conversationId, uid);
  const now = Date.now();
  const userIndexBasePath = userConversationsPath(conversation.isLegacy);
  const conversationBasePath = conversation.storagePath || `${CONVERSATIONS_PATH}/${conversationId}`;

  await rtdb.ref().update({
    [`${userIndexBasePath}/${uid}/${conversationId}/unreadCount`]: 0,
    [`${conversationBasePath}/memberMeta/${uid}/lastReadAt`]: now,
  });
  return { conversationId, unreadCount: 0, readAt: now };
}

async function updateGroupConversation(uid, conversationId, data) {
  const conversation = await getConversationOrFail(conversationId, uid);
  if (conversation.type !== "group") throw new AppError("Apenas grupos podem ser editados.", 400);
  if (conversation.createdBy !== uid) throw new AppError("Apenas o criador pode editar o grupo.", 403);

  const conversationBasePath = conversation.storagePath || `${CONVERSATIONS_PATH}/${conversationId}`;
  const userIndexBasePath = userConversationsPath(conversation.isLegacy);
  const updates = {};
  if (data.name !== undefined) updates[`${conversationBasePath}/name`] = data.name;
  if (data.photoURL !== undefined) updates[`${conversationBasePath}/photoURL`] = data.photoURL || null;
  updates[`${conversationBasePath}/updatedAt`] = Date.now();
  updates[`${GROUPS_BY_OWNER_PATH}/${uid}/${conversationId}/updatedAt`] = Date.now();
  if (data.name !== undefined) updates[`${GROUPS_BY_OWNER_PATH}/${uid}/${conversationId}/name`] = data.name;
  await rtdb.ref().update(updates);

  const updated = await getConversationOrFail(conversationId, uid);
  const profiles = await getUsersByIds(Object.keys(updated.members || {}));
  const indexSnapshot = await rtdb.ref(`${userIndexBasePath}/${uid}/${conversationId}`).get();
  return serializeConversation(updated, indexSnapshot.val() || {}, profiles, uid);
}

async function addGroupMembers(uid, conversationId, { memberIds = [], memberUsernames = [] }) {
  const conversation = await getConversationOrFail(conversationId, uid);
  if (conversation.type !== "group") throw new AppError("Apenas grupos aceitam novos membros.", 400);
  if (conversation.createdBy !== uid) throw new AppError("Apenas o criador pode adicionar membros.", 403);

  const resolvedMembers = await resolveMembers({ memberIds, memberUsernames });
  const currentMemberIds = Object.keys(conversation.members || {});
  const nextMemberIds = new Set([...currentMemberIds, ...resolvedMembers.map((member) => member.uid)]);
  if (nextMemberIds.size > MAX_GROUP_MEMBERS) throw new AppError("Grupo excede o limite de participantes.", 400);
  await ensureFollowsUsers(uid, resolvedMembers.map((member) => member.uid));

  const now = Date.now();
  const conversationBasePath = conversation.storagePath || `${CONVERSATIONS_PATH}/${conversationId}`;
  const userIndexBasePath = userConversationsPath(conversation.isLegacy);
  const updates = {};
  resolvedMembers.forEach((member) => {
    if (conversation.members?.[member.uid]) return;
    updates[`${conversationBasePath}/members/${member.uid}`] = true;
    updates[`${conversationBasePath}/memberMeta/${member.uid}`] = { joinedAt: now, lastReadAt: now };
    updates[`${userIndexBasePath}/${member.uid}/${conversationId}`] = {
      conversationId,
      updatedAt: now,
      unreadCount: 1,
      lastMessagePreview: `${conversation.name || "Grupo"} adicionou voce.`,
    };
  });
  updates[`${conversationBasePath}/updatedAt`] = now;

  await rtdb.ref().update(updates);
  return updateGroupConversation(uid, conversationId, {});
}

async function removeGroupMember(uid, conversationId, memberId) {
  const conversation = await getConversationOrFail(conversationId, uid);
  if (conversation.type !== "group") throw new AppError("Apenas grupos aceitam remoção de membros.", 400);
  if (uid !== memberId && conversation.createdBy !== uid) throw new AppError("Voce não pode remover este membro.", 403);
  if (!conversation.members?.[memberId]) throw new AppError("Membro não encontrado no grupo.", 404);

  const conversationBasePath = conversation.storagePath || `${CONVERSATIONS_PATH}/${conversationId}`;
  const userIndexBasePath = userConversationsPath(conversation.isLegacy);
  const updates = {
    [`${conversationBasePath}/members/${memberId}`]: null,
    [`${conversationBasePath}/memberMeta/${memberId}`]: null,
    [`${userIndexBasePath}/${memberId}/${conversationId}`]: null,
    [`${conversationBasePath}/updatedAt`]: Date.now(),
  };
  await rtdb.ref().update(updates);
  return { removed: true };
}

async function deleteConversationForUser(uid, conversationId) {
  const conversation = await getConversationOrFail(conversationId, uid);
  const conversationBasePath = conversation.storagePath || `${CONVERSATIONS_PATH}/${conversationId}`;
  const now = Date.now();
  const updates = {
    [`${USER_CONVERSATIONS_PATH}/${uid}/${conversationId}`]: null,
    [`${LEGACY_PATHS.userConversations}/${uid}/${conversationId}`]: null,
    [`${conversationBasePath}/memberMeta/${uid}/hiddenAt`]: now,
  };

  if (conversation.type === "direct") {
    updates[`${conversationBasePath}/memberMeta/${uid}/clearedAt`] = now;
  } else if (conversation.type === "group") {
    updates[`${HIDDEN_GROUPS_BY_USER_PATH}/${uid}/${conversationId}`] = {
      conversationId,
      name: conversation.name || "Grupo",
      hiddenAt: now,
      updatedAt: conversation.updatedAt || now,
    };
  }

  await rtdb.ref().update(updates);
  return { deleted: true };
}

async function restoreConversationForUser(uid, conversationId) {
  const conversation = await getConversationOrFail(conversationId, uid);
  const userIndexBasePath = userConversationsPath(conversation.isLegacy);
  const conversationBasePath = conversation.storagePath || `${CONVERSATIONS_PATH}/${conversationId}`;
  const visibleLastMessage = getVisibleLastMessage(conversation, uid);
  const lastMessage = serializeLastMessage(visibleLastMessage);
  const userIndex = {
    conversationId,
    updatedAt: visibleLastMessage?.createdAt || conversation.updatedAt || Date.now(),
    unreadCount: 0,
    lastMessagePreview: lastMessage?.preview || "",
  };

  await rtdb.ref().update({
    [`${userIndexBasePath}/${uid}/${conversationId}`]: userIndex,
    [`${conversationBasePath}/memberMeta/${uid}/hiddenAt`]: null,
    [`${HIDDEN_GROUPS_BY_USER_PATH}/${uid}/${conversationId}`]: null,
  });

  const profiles = await getUsersByIds(Object.keys(conversation.members || {}));
  return serializeConversation(conversation, userIndex, profiles, uid);
}

async function listHiddenOwnedGroups(uid) {
  const [index, ownerIndexSnapshot] = await Promise.all([
    getUserConversationIndex(uid),
    rtdb.ref(`${GROUPS_BY_OWNER_PATH}/${uid}`).get(),
  ]);
  const hiddenIndexSnapshot = await rtdb.ref(`${HIDDEN_GROUPS_BY_USER_PATH}/${uid}`).get();
  let hiddenGroupIds = Object.keys(hiddenIndexSnapshot.val() || {});
  let ownedGroupIds = Object.keys(ownerIndexSnapshot.val() || {});

  if (ownedGroupIds.length === 0) {
    const allConversationsSnapshot = await rtdb.ref(CONVERSATIONS_PATH).get();
    const ownerIndexUpdates = {};

    ownedGroupIds = Object.entries(allConversationsSnapshot.val() || {})
      .filter(([, conversation]) => conversation.type === "group" && conversation.createdBy === uid)
      .map(([conversationId, conversation]) => {
        ownerIndexUpdates[`${GROUPS_BY_OWNER_PATH}/${uid}/${conversationId}`] = {
          conversationId,
          name: conversation.name || "Grupo",
          createdAt: conversation.createdAt || null,
          updatedAt: conversation.updatedAt || conversation.createdAt || Date.now(),
        };
        return conversationId;
      });

    if (Object.keys(ownerIndexUpdates).length > 0) {
      await rtdb.ref().update(ownerIndexUpdates);
    }
  }

  if (hiddenGroupIds.length === 0) {
    const [currentConversationsSnapshot, legacyConversationsSnapshot] = await Promise.all([
      rtdb.ref(CONVERSATIONS_PATH).get(),
      rtdb.ref(LEGACY_PATHS.conversations).get(),
    ]);
    const hiddenIndexUpdates = {};
    const discovered = [
      ...Object.entries(currentConversationsSnapshot.val() || {}),
      ...Object.entries(legacyConversationsSnapshot.val() || {}),
    ]
      .filter(([conversationId, conversation]) => (
        conversation.type === "group" &&
        conversation.members?.[uid] &&
        conversation.memberMeta?.[uid]?.hiddenAt &&
        !index[conversationId]
      ))
      .map(([conversationId, conversation]) => {
        hiddenIndexUpdates[`${HIDDEN_GROUPS_BY_USER_PATH}/${uid}/${conversationId}`] = {
          conversationId,
          name: conversation.name || "Grupo",
          hiddenAt: conversation.memberMeta?.[uid]?.hiddenAt || Date.now(),
          updatedAt: conversation.updatedAt || conversation.createdAt || Date.now(),
        };
        return conversationId;
      });

    if (Object.keys(hiddenIndexUpdates).length > 0) {
      await rtdb.ref().update(hiddenIndexUpdates);
    }

    hiddenGroupIds = discovered;
  }

  const candidateGroupIds = [...new Set([...hiddenGroupIds, ...ownedGroupIds])];
  if (candidateGroupIds.length === 0) return [];

  const conversationSnapshots = await Promise.all(
    candidateGroupIds.map((conversationId) =>
      firstExistingSnapshot([
        `${CONVERSATIONS_PATH}/${conversationId}`,
        `${LEGACY_PATHS.conversations}/${conversationId}`,
      ])
    )
  );
  const conversations = conversationSnapshots
    .map(({ snapshot }, indexPosition) =>
      snapshot?.exists()
        ? { id: candidateGroupIds[indexPosition], hidden: true, ...snapshot.val() }
        : null
    )
    .filter(Boolean)
    .filter((conversation) => conversation.type === "group")
    .filter((conversation) => conversation.members?.[uid])
    .filter((conversation) => !index[conversation.id] && conversation.memberMeta?.[uid]?.hiddenAt);

  if (conversations.length === 0) return [];

  const profiles = await getUsersByIds(conversations.flatMap((conversation) => Object.keys(conversation.members || {})));
  return conversations
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    .map((conversation) => serializeConversation(conversation, {}, profiles, uid));
}

async function deleteGroupConversation(uid, conversationId) {
  const conversation = await getConversationOrFail(conversationId, uid);
  if (conversation.type !== "group") throw new AppError("Apenas grupos podem ser excluidos por aqui.", 400);
  if (conversation.createdBy !== uid) throw new AppError("Apenas o criador pode excluir o grupo.", 403);

  const memberIds = Object.keys(conversation.members || {});
  const updates = {
    [`${CONVERSATIONS_PATH}/${conversationId}`]: null,
    [`${LEGACY_PATHS.conversations}/${conversationId}`]: null,
    [`${MESSAGES_PATH}/${conversationId}`]: null,
    [`${LEGACY_PATHS.messages}/${conversationId}`]: null,
    [`${GROUPS_BY_OWNER_PATH}/${uid}/${conversationId}`]: null,
  };

  memberIds.forEach((memberId) => {
    updates[`${USER_CONVERSATIONS_PATH}/${memberId}/${conversationId}`] = null;
    updates[`${LEGACY_PATHS.userConversations}/${memberId}/${conversationId}`] = null;
    updates[`${HIDDEN_GROUPS_BY_USER_PATH}/${memberId}/${conversationId}`] = null;
  });

  await rtdb.ref().update(updates);
  return { deleted: true };
}

async function getTotalUnreadCount(uid) {
  const conversations = await getUserConversationIndex(uid);
  return Object.values(conversations).reduce((total, item) => total + (Number(item.unreadCount) || 0), 0);
}

async function getMessageNotificationSummaries(uid, limit = 5) {
  const index = await getUserConversationIndex(uid);
  const entries = Object.entries(index)
    .map(([conversationId, data]) => ({ conversationId, ...data }))
    .filter((item) => Number(item.unreadCount) > 0)
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    .slice(0, limit);

  if (entries.length === 0) return [];

  const conversationSnapshots = await Promise.all(
    entries.map((item) =>
      firstExistingSnapshot([
        `${CONVERSATIONS_PATH}/${item.conversationId}`,
        `${LEGACY_PATHS.conversations}/${item.conversationId}`,
      ])
    )
  );
  const conversations = conversationSnapshots
    .map(({ snapshot }, index) => (snapshot?.exists() ? { id: entries[index].conversationId, ...snapshot.val(), index: entries[index] } : null))
    .filter(Boolean);
  const profiles = await getUsersByIds(conversations.flatMap((conversation) => Object.keys(conversation.members || {})));

  return conversations.map((conversation) => {
    const name = conversationTitleForUser(conversation, profiles, uid);
    const count = conversation.index.unreadCount || 0;
    return {
      id: `message_${conversation.id}`,
      type: "message",
      title: "Nova mensagem",
      message: count > 1 ? `${count} novas mensagens em ${name}.` : `Nova mensagem em ${name}.`,
      read: false,
      createdAt: new Date(conversation.updatedAt || Date.now()),
      conversationId: conversation.id,
      senderName: conversation.lastMessage?.senderName || null,
      senderPhoto: conversation.lastMessage?.senderPhoto || null,
    };
  });
}

async function subscribeConversations(uid, onChange) {
  const currentRef = rtdb.ref(`${USER_CONVERSATIONS_PATH}/${uid}`);
  const legacyRef = rtdb.ref(`${LEGACY_PATHS.userConversations}/${uid}`);
  let currentValue = {};
  let legacyValue = {};

  const emit = () => {
    const conversations = { ...legacyValue, ...currentValue };
    const unreadCount = Object.values(conversations).reduce(
      (total, item) => total + (Number(item.unreadCount) || 0),
      0
    );

    onChange({ type: "conversations", unreadCount, updatedAt: Date.now() });
  };
  const currentHandler = (snapshot) => {
    currentValue = snapshot.val() || {};
    emit();
  };
  const legacyHandler = (snapshot) => {
    legacyValue = snapshot.val() || {};
    emit();
  };

  currentRef.on("value", currentHandler);
  legacyRef.on("value", legacyHandler);
  return () => {
    currentRef.off("value", currentHandler);
    legacyRef.off("value", legacyHandler);
  };
}

async function subscribeMessages(uid, conversationId, onChange) {
  const conversation = await getConversationOrFail(conversationId, uid);
  const ref = rtdb.ref(`${messagesPath(conversation.isLegacy)}/${conversationId}`);
  const handler = (snapshot) => {
    onChange({
      type: "messages",
      conversationId,
      count: snapshot.numChildren(),
      updatedAt: Date.now(),
    });
  };

  ref.on("value", handler);
  return () => ref.off("value", handler);
}

module.exports = {
  listConversations,
  createDirectConversation,
  createGroupConversation,
  getMessages,
  sendMessage,
  markConversationRead,
  updateGroupConversation,
  addGroupMembers,
  removeGroupMember,
  deleteConversationForUser,
  restoreConversationForUser,
  listHiddenOwnedGroups,
  deleteGroupConversation,
  getTotalUnreadCount,
  getMessageNotificationSummaries,
  subscribeConversations,
  subscribeMessages,
};
