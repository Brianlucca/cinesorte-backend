const { db, admin } = require("../../config/firebase");
const logger = require("../../shared/utils/logger");

const CLEANUP_INTERVAL_MS = 15 * 60 * 1000;
const CLEANUP_BATCH_SIZE = 400;

async function deleteExpiredPairingCodes() {
  let deleted = 0;
  let hasMore = true;

  while (hasMore) {
    const snapshot = await db
      .collection("extensionPairingCodes")
      .where("expiresAt", "<=", admin.firestore.Timestamp.now())
      .limit(CLEANUP_BATCH_SIZE)
      .get();

    if (snapshot.empty) break;
    const batch = db.batch();
    snapshot.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
    deleted += snapshot.size;
    hasMore = snapshot.size === CLEANUP_BATCH_SIZE;
  }

  if (deleted > 0)
    logger.info(`Removed ${deleted} expired extension pairing codes`);
  return deleted;
}

function startExtensionCleanup() {
  const run = () =>
    deleteExpiredPairingCodes().catch((error) =>
      logger.error(`Extension pairing cleanup failed: ${error.message}`),
    );

  run();
  const timer = setInterval(run, CLEANUP_INTERVAL_MS);
  timer.unref?.();
  return timer;
}

module.exports = { deleteExpiredPairingCodes, startExtensionCleanup };
