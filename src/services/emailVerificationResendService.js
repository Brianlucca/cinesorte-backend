const { auth, db, admin } = require("../config/firebase");
const logger = require("../utils/logger");
const { sendVerificationEmail } = require("./email");

const DEFAULT_LIMIT = 100;
const DEFAULT_MIN_AGE_MINUTES = 5;
const DEFAULT_COOLDOWN_HOURS = 6;
const DEFAULT_MAX_RESCUE_SENDS = 1;

const toDate = (value) => {
  if (!value) return null;
  if (typeof value.toDate === "function") return value.toDate();
  if (value instanceof Date) return value;
  return new Date(value);
};

const isEmailPasswordUser = (userRecord) =>
  userRecord.providerData?.some((provider) => provider.providerId === "password");

const shouldSkipByCooldown = (userData, cooldownMs) => {
  const lastSentAt = toDate(userData.verificationEmailLastSentAt);
  if (!lastSentAt) return false;
  return Date.now() - lastSentAt.getTime() < cooldownMs;
};

const shouldSkipByAge = (userRecord, minAgeMs) => {
  const createdAt = new Date(userRecord.metadata.creationTime);
  if (Number.isNaN(createdAt.getTime())) return false;
  return Date.now() - createdAt.getTime() < minAgeMs;
};

const shouldSkipByMaxSends = (userData, maxRescueSends) => {
  if (!Number.isFinite(maxRescueSends) || maxRescueSends < 0) return false;
  return Number(userData.verificationEmailResendCount || 0) >= maxRescueSends;
};

const markVerificationEmailAttempt = async ({ userRef, result, dryRun }) => {
  if (dryRun) return;

  await userRef.set(
    {
      verificationEmailLastSentAt: admin.firestore.Timestamp.now(),
      verificationEmailLastStatus: result.sent
        ? "sent"
        : result.queued
          ? "queued"
          : result.skipped
            ? "skipped"
            : "failed",
      verificationEmailLastError: result.error || result.reason || null,
      verificationEmailResendCount: admin.firestore.FieldValue.increment(1),
      updatedAt: new Date(),
    },
    { merge: true }
  );
};

const sendVerificationForUser = async ({ userRecord, userData, userRef, dryRun }) => {
  const payload = {
    userEmail: userRecord.email,
    userName: userData.name || userRecord.displayName || userData.username,
    username: userData.username,
    verificationLink: dryRun ? "dry-run" : await auth.generateEmailVerificationLink(userRecord.email),
  };

  if (dryRun) {
    return { sent: false, queued: false, skipped: true, reason: "dry_run", payload };
  }

  const result = await sendVerificationEmail(payload);
  await markVerificationEmailAttempt({ userRef, result, dryRun });
  return result;
};

const resendPendingVerificationEmails = async ({
  limit = DEFAULT_LIMIT,
  dryRun = false,
  minAgeMinutes = DEFAULT_MIN_AGE_MINUTES,
  cooldownHours = DEFAULT_COOLDOWN_HOURS,
  maxRescueSends = DEFAULT_MAX_RESCUE_SENDS,
} = {}) => {
  const maxUsers = Math.max(1, Number(limit) || DEFAULT_LIMIT);
  const minAgeMs = Math.max(0, Number(minAgeMinutes) || 0) * 60 * 1000;
  const cooldownMs = Math.max(0, Number(cooldownHours) || 0) * 60 * 60 * 1000;
  const maxSends = Number(maxRescueSends);
  const summary = {
    scanned: 0,
    candidates: 0,
    sent: 0,
    queued: 0,
    skipped: 0,
    failed: 0,
    dryRun,
    users: [],
  };

  let nextPageToken;

  do {
    const page = await auth.listUsers(Math.min(1000, maxUsers - summary.scanned), nextPageToken);
    nextPageToken = page.pageToken;

    for (const userRecord of page.users) {
      if (summary.scanned >= maxUsers) break;
      summary.scanned += 1;

      if (!userRecord.email || userRecord.emailVerified || !isEmailPasswordUser(userRecord)) continue;

      const userRef = db.collection("users").doc(userRecord.uid);
      const userDoc = await userRef.get();
      const userData = userDoc.data() || {};

      if (shouldSkipByMaxSends(userData, maxSends)) {
        summary.skipped += 1;
        summary.users.push({ uid: userRecord.uid, email: userRecord.email, status: "skipped_max_rescue_sends" });
        continue;
      }

      if (shouldSkipByAge(userRecord, minAgeMs)) {
        summary.skipped += 1;
        summary.users.push({ uid: userRecord.uid, email: userRecord.email, status: "skipped_recent_account" });
        continue;
      }

      if (shouldSkipByCooldown(userData, cooldownMs)) {
        summary.skipped += 1;
        summary.users.push({ uid: userRecord.uid, email: userRecord.email, status: "skipped_cooldown" });
        continue;
      }

      summary.candidates += 1;

      try {
        const result = await sendVerificationForUser({ userRecord, userData, userRef, dryRun });
        const status = result.sent ? "sent" : result.queued ? "queued" : result.skipped ? "skipped" : "failed";

        if (result.sent) summary.sent += 1;
        else if (result.queued) summary.queued += 1;
        else if (result.skipped) summary.skipped += 1;
        else summary.failed += 1;

        summary.users.push({
          uid: userRecord.uid,
          email: userRecord.email,
          username: userData.username || null,
          status,
          reason: result.reason || result.error || null,
          jobId: result.jobId || null,
        });
      } catch (error) {
        summary.failed += 1;
        summary.users.push({
          uid: userRecord.uid,
          email: userRecord.email,
          username: userData.username || null,
          status: "failed",
          reason: error.message || String(error),
        });
        logger.error("verification resend failed: %s", error.message || error);
      }
    }
  } while (nextPageToken && summary.scanned < maxUsers);

  return summary;
};

module.exports = {
  resendPendingVerificationEmails,
};
