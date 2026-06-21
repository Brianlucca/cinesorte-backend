const crypto = require("crypto");
const dns = require("dns");
const nodemailer = require("nodemailer");
const env = require("../../config/env");
const logger = require("../../utils/logger");
const { db, admin } = require("../../config/firebase");

if (typeof dns.setDefaultResultOrder === "function") {
  dns.setDefaultResultOrder("ipv4first");
}

const EMAIL_JOB_COLLECTION = "email_jobs";
const SMTP_OUTBOUND_ENABLED = false;
const MAX_INLINE_ATTEMPTS = 3;
const MAX_QUEUE_ATTEMPTS = Number(env.EMAIL_RETRY_MAX_ATTEMPTS || 7);

const hasSmtpConfig = () =>
  Boolean(env.SMTP_HOST && env.SMTP_PORT && env.SMTP_USER && env.SMTP_PASS);

let smtpSendChain = Promise.resolve();

const runSerializedSmtpSend = (task) => {
  const run = smtpSendChain.then(task, task);
  smtpSendChain = run.catch(() => {});
  return run;
};

const createTransporter = async () => {
  if (!hasSmtpConfig()) {
    return null;
  }

  const { address } = await dns.promises.lookup(env.SMTP_HOST, { family: 4 });

  return nodemailer.createTransport({
    host: address,
    port: Number(env.SMTP_PORT),
    secure: String(env.SMTP_SECURE).toLowerCase() === "true",
    auth: {
      user: env.SMTP_USER,
      pass: env.SMTP_PASS,
    },
    family: 4,
    requireTLS: String(env.SMTP_SECURE).toLowerCase() !== "true",
    tls: {
      servername: env.SMTP_HOST,
    },
    connectionTimeout: 45000,
    greetingTimeout: 45000,
    socketTimeout: 60000,
  });
};

const getFromEmail = () => env.SUPPORT_FROM_EMAIL || env.SMTP_USER;
const getSupportInbox = () => env.SUPPORT_TO_EMAIL || env.SMTP_USER;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const buildMailOptions = ({ to, subject, text, html, replyTo, threadMessageId, priority }) => {
  const isHighPriority = priority === "high";

  return {
    from: getFromEmail(),
    to,
    subject,
    text,
    html,
    replyTo,
    inReplyTo: threadMessageId || undefined,
    references: threadMessageId || undefined,
    priority: isHighPriority ? "high" : undefined,
    headers: isHighPriority
      ? {
          Importance: "high",
          "X-Priority": "1",
          Priority: "urgent",
        }
      : undefined,
  };
};

const sendMailNow = async (payload) => {
  // SMTP de saida desativado. Confirmacao e redefinicao de senha usam Firebase.
  if (!SMTP_OUTBOUND_ENABLED) {
    return { skipped: true, sent: false, reason: "smtp_disabled" };
  }

  if (!payload?.to) {
    return { skipped: true, reason: "missing_recipient" };
  }

  return runSerializedSmtpSend(async () => {
    const transport = await createTransporter();
    if (!transport) {
      return { skipped: true, reason: "smtp_not_configured" };
    }

    try {
      const info = await transport.sendMail(buildMailOptions(payload));
      return {
        skipped: false,
        sent: true,
        messageId: info?.messageId || null,
      };
    } finally {
      if (typeof transport.close === "function") {
        transport.close();
      }
    }
  });
};

const buildJobHash = (payload) =>
  crypto
    .createHash("sha1")
    .update(JSON.stringify({
      to: payload.to,
      subject: payload.subject,
      text: payload.text,
      html: payload.html,
      replyTo: payload.replyTo,
      threadMessageId: payload.threadMessageId,
      logLabel: payload.logLabel,
    }))
    .digest("hex");

const queueEmailJob = async (payload, errorMessage) => {
  const dedupeHash = buildJobHash(payload);
  const existing = await db.collection(EMAIL_JOB_COLLECTION).where("dedupeHash", "==", dedupeHash).where("status", "in", ["pending", "retrying"]).limit(1).get();

  if (!existing.empty) {
    const doc = existing.docs[0];
    await doc.ref.update({
      updatedAt: admin.firestore.Timestamp.now(),
      lastError: errorMessage,
    });
    logger.warn("email job deduplicated: %s", payload.logLabel || doc.id);
    return { queued: true, jobId: doc.id, deduplicated: true };
  }

  const now = admin.firestore.Timestamp.now();
  const docRef = db.collection(EMAIL_JOB_COLLECTION).doc();
  await docRef.set({
    payload,
    dedupeHash,
    status: "pending",
    attempts: 0,
    queuedAt: now,
    updatedAt: now,
    nextAttemptAt: now,
    lastError: errorMessage || null,
  });

  logger.warn("email job queued: %s", payload.logLabel || docRef.id);
  return { queued: true, jobId: docRef.id, deduplicated: false };
};

const sendMail = async (payload) => {
  // Impede conexoes, retries e novos jobs SMTP em qualquer fluxo da aplicacao.
  if (!SMTP_OUTBOUND_ENABLED) {
    return { skipped: true, sent: false, queued: false, reason: "smtp_disabled" };
  }

  if (!hasSmtpConfig()) {
    return { skipped: true, reason: "smtp_not_configured" };
  }

  if (!payload?.to) {
    return { skipped: true, reason: "missing_recipient" };
  }

  let lastError = null;

  for (let attempt = 1; attempt <= MAX_INLINE_ATTEMPTS; attempt += 1) {
    try {
      const result = await sendMailNow(payload);
      if (attempt > 1) {
        logger.info("%s succeeded after retry %s", payload.logLabel || "email_delivery", attempt);
      } else {
        logger.info("%s sent", payload.logLabel || "email_delivery");
      }
      return { ...result, queued: false, attempts: attempt };
    } catch (error) {
      lastError = error;
      logger.warn("%s attempt %s failed: %s", payload.logLabel || "email_delivery", attempt, error.message || error);
      if (attempt < MAX_INLINE_ATTEMPTS) {
        await wait(1200 * attempt);
      }
    }
  }

  const errorMessage = lastError?.message || String(lastError || "unknown_error");
  if (payload.disableQueue) {
    logger.error("%s failed after retries and was not queued: %s", payload.logLabel || "email_delivery", errorMessage);
    return {
      skipped: false,
      sent: false,
      queued: false,
      error: errorMessage,
    };
  }

  const queueResult = await queueEmailJob(payload, errorMessage);
  logger.error("%s failed after retries and was queued: %s", payload.logLabel || "email_delivery", errorMessage);
  return {
    skipped: false,
    sent: false,
    queued: true,
    error: errorMessage,
    jobId: queueResult.jobId,
  };
};

const processEmailJob = async (jobDoc) => {
  const data = jobDoc.data() || {};
  const attempts = Number(data.attempts || 0) + 1;
  const payload = data.payload || {};
  const updateJob = async (dataToUpdate) => {
    try {
      await jobDoc.ref.update(dataToUpdate);
      return true;
    } catch (error) {
      if (error?.code === 5 || /NOT_FOUND/i.test(error?.message || "")) {
        logger.warn("queued email job disappeared before update: %s", payload.logLabel || jobDoc.id);
        return false;
      }
      throw error;
    }
  };

  try {
    const result = await sendMailNow(payload);
    await jobDoc.ref.delete();
    logger.info(
      "queued email sent and removed: %s",
      payload.logLabel || result.messageId || jobDoc.id
    );
  } catch (error) {
    const shouldFailPermanently = attempts >= MAX_QUEUE_ATTEMPTS;
    const delayMinutes = Math.min(30, attempts * 2);
    const nextAttemptAt = admin.firestore.Timestamp.fromDate(new Date(Date.now() + delayMinutes * 60 * 1000));

    if (shouldFailPermanently) {
      await jobDoc.ref.delete();
      logger.error(
        "queued email permanently failed after %s attempts and was removed: %s",
        attempts,
        payload.logLabel || jobDoc.id
      );
      return;
    }

    await updateJob({
      status: "retrying",
      attempts,
      updatedAt: admin.firestore.Timestamp.now(),
      nextAttemptAt,
      lastError: error.message || String(error),
    });

    logger.warn("queued email retry scheduled: %s", payload.logLabel || jobDoc.id);
  }
};

module.exports = {
  EMAIL_JOB_COLLECTION,
  hasSmtpConfig,
  createTransporter,
  getFromEmail,
  getSupportInbox,
  processEmailJob,
  queueEmailJob,
  sendMail,
  sendMailNow,
};
