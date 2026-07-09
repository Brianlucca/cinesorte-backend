const crypto = require("crypto");
const { rtdb } = require("../../config/firebase");

const MESSAGE_ROOT = "messages";
const CONVERSATIONS_PATH = `${MESSAGE_ROOT}/conversations`;
const MESSAGES_PATH = `${MESSAGE_ROOT}/messagesByConversation`;
const USER_CONVERSATIONS_PATH = `${MESSAGE_ROOT}/conversationsByUser`;
const DIRECT_PAIRS_PATH = `${MESSAGE_ROOT}/directPairs`;
const GROUPS_BY_OWNER_PATH = `${MESSAGE_ROOT}/groupsByOwner`;
const HIDDEN_GROUPS_BY_USER_PATH = `${MESSAGE_ROOT}/hiddenGroupsByUser`;

const LEGACY_PATHS = {
  conversations: "messageConversations",
  messages: "messageItems",
  userConversations: "userMessageConversations",
  directPairs: "directMessagePairs",
};

async function firstExistingSnapshot(paths) {
  for (const path of paths) {
    const snapshot = await rtdb.ref(path).get();
    if (snapshot.exists()) return { snapshot, path };
  }
  return { snapshot: null, path: paths[0] };
}

function directPairKey(uidA, uidB) {
  return crypto
    .createHash("sha256")
    .update([uidA, uidB].sort().join(":"))
    .digest("base64url");
}

function userConversationsPath(isLegacy = false) {
  return isLegacy ? LEGACY_PATHS.userConversations : USER_CONVERSATIONS_PATH;
}

function messagesPath(isLegacy = false) {
  return isLegacy ? LEGACY_PATHS.messages : MESSAGES_PATH;
}

function isMissingIndexError(error) {
  return String(error?.message || "").includes("Index not defined");
}

module.exports = {
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
};
