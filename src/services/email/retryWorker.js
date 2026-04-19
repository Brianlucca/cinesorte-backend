const env = require("../../config/env");
const logger = require("../../utils/logger");
const { db, admin } = require("../../config/firebase");
const { EMAIL_JOB_COLLECTION, hasSmtpConfig, processEmailJob } = require("./transport");

let started = false;
let running = false;
let timer = null;

const POLL_INTERVAL_MS = Number(env.EMAIL_RETRY_INTERVAL_MS || 60000);

const processPendingJobs = async () => {
  if (!hasSmtpConfig()) {
    return;
  }

  const now = admin.firestore.Timestamp.now();
  const snapshot = await db
    .collection(EMAIL_JOB_COLLECTION)
    .where("status", "in", ["pending", "retrying"])
    .where("nextAttemptAt", "<=", now)
    .limit(10)
    .get();

  for (const doc of snapshot.docs) {
    await processEmailJob(doc);
  }
};

const tick = async () => {
  if (!started) {
    timer = null;
    return;
  }

  if (running) {
    timer = setTimeout(tick, POLL_INTERVAL_MS);
    return;
  }

  running = true;
  try {
    await processPendingJobs();
  } catch (error) {
    logger.warn("Email retry worker failed: %s", error?.message || error);
  } finally {
    running = false;
    if (started) {
      timer = setTimeout(tick, POLL_INTERVAL_MS);
    } else {
      timer = null;
    }
  }
};

const startEmailRetryWorker = () => {
  if (started || !hasSmtpConfig()) return;
  started = true;
  tick();
  logger.info("Email retry worker ativo");
};

const stopEmailRetryWorker = () => {
  started = false;
  running = false;
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
};

module.exports = {
  startEmailRetryWorker,
  stopEmailRetryWorker,
};