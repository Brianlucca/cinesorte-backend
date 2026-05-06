const { db, admin } = require("../config/firebase");
const env = require("../config/env");
const logger = require("../utils/logger");

const ACCOUNT_DELETION_REQUESTS = "account_deletion_requests";
const DEFAULT_INTERVAL_MS = 10 * 60 * 1000;
const DEFAULT_LIMIT = 100;

let started = false;
let running = false;
let timer = null;

const isEnabled = () =>
  String(env.ACCOUNT_DELETION_CLEANUP_ENABLED || "true").toLowerCase() !== "false";

const INTERVAL_MS = Number(env.ACCOUNT_DELETION_CLEANUP_INTERVAL_MS || DEFAULT_INTERVAL_MS);
const LIMIT = Number(env.ACCOUNT_DELETION_CLEANUP_LIMIT || DEFAULT_LIMIT);

const cleanupExpiredAccountDeletionRequests = async ({ limit = LIMIT } = {}) => {
  const now = admin.firestore.Timestamp.now();
  const snapshot = await db
    .collection(ACCOUNT_DELETION_REQUESTS)
    .where("expiresAt", "<=", now)
    .limit(Math.max(1, Number(limit) || DEFAULT_LIMIT))
    .get();

  if (snapshot.empty) return 0;

  const batch = db.batch();
  snapshot.docs.forEach((doc) => batch.delete(doc.ref));
  await batch.commit();

  return snapshot.size;
};

const tick = async () => {
  if (!started) {
    timer = null;
    return;
  }

  if (running) {
    timer = setTimeout(tick, INTERVAL_MS);
    return;
  }

  running = true;
  try {
    const deleted = await cleanupExpiredAccountDeletionRequests();
    if (deleted > 0) {
      logger.info("account deletion request cleanup removed %s expired request(s)", deleted);
    }
  } catch (error) {
    logger.warn("Account deletion cleanup worker failed: %s", error?.message || error);
  } finally {
    running = false;
    timer = started ? setTimeout(tick, INTERVAL_MS) : null;
  }
};

const startAccountDeletionRequestCleanupWorker = () => {
  if (started || !isEnabled()) return;
  started = true;
  tick();
  logger.info("Account deletion cleanup worker ativo");
};

const stopAccountDeletionRequestCleanupWorker = () => {
  started = false;
  running = false;
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
};

module.exports = {
  cleanupExpiredAccountDeletionRequests,
  startAccountDeletionRequestCleanupWorker,
  stopAccountDeletionRequestCleanupWorker,
};
