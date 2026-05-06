const env = require("../config/env");
const logger = require("../utils/logger");
const { hasSmtpConfig } = require("./email");
const { resendPendingVerificationEmails } = require("./emailVerificationResendService");

let started = false;
let running = false;
let timer = null;

const isEnabled = () => String(env.VERIFICATION_EMAIL_RESCUE_ENABLED || "true").toLowerCase() !== "false";

const INTERVAL_MS = Number(env.VERIFICATION_EMAIL_RESCUE_INTERVAL_MS || 6 * 60 * 60 * 1000);
const LIMIT = Number(env.VERIFICATION_EMAIL_RESCUE_LIMIT || 100);
const MIN_AGE_MINUTES = Number(env.VERIFICATION_EMAIL_RESCUE_MIN_AGE_MINUTES || 10);
const COOLDOWN_HOURS = Number(env.VERIFICATION_EMAIL_RESCUE_COOLDOWN_HOURS || 6);
const MAX_RESCUE_SENDS = Number(env.VERIFICATION_EMAIL_RESCUE_MAX_SENDS || 1);

const runOnce = async () => {
  if (!hasSmtpConfig()) return;

  const summary = await resendPendingVerificationEmails({
    limit: LIMIT,
    minAgeMinutes: MIN_AGE_MINUTES,
    cooldownHours: COOLDOWN_HOURS,
    maxRescueSends: MAX_RESCUE_SENDS,
    dryRun: false,
  });

  if (summary.candidates || summary.sent || summary.queued || summary.failed) {
    logger.info("verification email rescue summary", {
      scanned: summary.scanned,
      candidates: summary.candidates,
      sent: summary.sent,
      queued: summary.queued,
      skipped: summary.skipped,
      failed: summary.failed,
    });
  }
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
    await runOnce();
  } catch (error) {
    logger.warn("Verification email rescue worker failed: %s", error?.message || error);
  } finally {
    running = false;
    if (started) {
      timer = setTimeout(tick, INTERVAL_MS);
    } else {
      timer = null;
    }
  }
};

const startVerificationEmailRescueWorker = () => {
  if (started || !isEnabled() || !hasSmtpConfig()) return;
  started = true;
  tick();
  logger.info("Verification email rescue worker ativo");
};

const stopVerificationEmailRescueWorker = () => {
  started = false;
  running = false;
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
};

module.exports = {
  startVerificationEmailRescueWorker,
  stopVerificationEmailRescueWorker,
};
