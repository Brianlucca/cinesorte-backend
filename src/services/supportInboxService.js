const crypto = require("crypto");
const { ImapFlow } = require("imapflow");
const { simpleParser } = require("mailparser");
const env = require("../config/env");
const logger = require("../utils/logger");
const { db, admin } = require("../config/firebase");

let started = false;
let polling = false;
let pollingTimeout = null;
let activeClient = null;

const POLL_INTERVAL_MS = Number(env.IMAP_POLL_INTERVAL_MS || 60000);
const SUPPORT_INBOX = (env.SUPPORT_TO_EMAIL || env.SMTP_USER || "").toLowerCase();

const hasInboxConfig = () => {
  const user = env.IMAP_USER || env.SMTP_USER;
  const pass = env.IMAP_PASS || env.SMTP_PASS;
  return Boolean(user && pass);
};

const getImapConfig = () => ({
  host: env.IMAP_HOST || "imap.gmail.com",
  port: Number(env.IMAP_PORT || 993),
  secure: String(env.IMAP_SECURE || "true").toLowerCase() === "true",
  auth: {
    user: env.IMAP_USER || env.SMTP_USER,
    pass: env.IMAP_PASS || env.SMTP_PASS,
  },
  connectionTimeout: 30000,
  greetingTimeout: 30000,
  socketTimeout: 60000,
  logger: false,
});

const hashMessageId = (messageId) =>
  crypto.createHash("sha1").update(String(messageId || "")).digest("hex");

const extractProtocol = (subject = "") => {
  const match = String(subject).toUpperCase().match(/CS-\d{8}-[A-Z0-9]{4}/);
  return match ? match[0] : null;
};

const stripQuotedReply = (text = "") => {
  const normalized = String(text || "").replace(/\r/g, "").trim();
  if (!normalized) return "";

  const separators = [
    /\nOn .+wrote:\n/i,
    /\nEm .+escreveu:\n/i,
    /\nFrom:\s.+/i,
    /\nDe:\s.+/i,
    /\n-{2,}\s*Original Message\s*-{2,}/i,
  ];

  let cleanText = normalized;
  separators.forEach((pattern) => {
    const parts = cleanText.split(pattern);
    if (parts[0]) {
      cleanText = parts[0].trim();
    }
  });

  cleanText = cleanText
    .split("\n")
    .filter((line) => !line.trim().startsWith(">"))
    .join("\n")
    .trim();

  return cleanText;
};

const wasInboundMessageProcessed = async (messageId) => {
  const hash = hashMessageId(messageId);
  const doc = await db.collection("support_email_ingest").doc(hash).get();
  return doc.exists;
};

const markInboundMessageProcessed = async ({ messageId, protocol, status, fromEmail, subject }) => {
  const hash = hashMessageId(messageId || `${protocol}_${Date.now()}`);
  await db.collection("support_email_ingest").doc(hash).set({
    messageId: messageId || null,
    protocol: protocol || null,
    status,
    fromEmail: fromEmail || null,
    subject: subject || null,
    processedAt: admin.firestore.Timestamp.now(),
  });
};

const appendInboundReplyToTicket = async ({ ticket, replyText, fromEmail, fromName, messageId }) => {
  const now = admin.firestore.Timestamp.now();
  const entry = {
    id: `email_${now.toMillis()}`,
    role: "user",
    author: fromName || ticket.name || ticket.username || fromEmail || "Você",
    channel: "email",
    message: replyText,
    createdAt: now,
    source: "gmail_inbox",
  };

  await ticket.ref.update({
    status: "open",
    updatedAt: now,
    lastUserReplyAt: now,
    lastUserReplyChannel: "email",
    lastUserReplyEmailFrom: fromEmail || null,
    conversation: admin.firestore.FieldValue.arrayUnion(entry),
  });

  await markInboundMessageProcessed({
    messageId,
    protocol: ticket.protocol,
    status: "attached",
    fromEmail,
    subject: `[${ticket.protocol}] Atendimento CineSorte`,
  });

  logger.info("Support inbound email attached to %s from %s", ticket.protocol, fromEmail || "unknown_sender");
};

const disposeClient = async (client) => {
  if (!client) return;
  try {
    if (!client.closed) {
      await client.logout();
    }
  } catch (_) {
    try {
      client.close();
    } catch (_) {}
  }
  if (activeClient === client) {
    activeClient = null;
  }
};

const processMailbox = async () => {
  if (!hasInboxConfig()) {
    return;
  }

  const client = new ImapFlow(getImapConfig());
  activeClient = client;

  client.on("error", (error) => {
    logger.warn("Support inbox client error: %s", error?.message || error);
  });

  client.on("close", () => {
    if (activeClient === client) {
      activeClient = null;
    }
  });

  try {
    await client.connect();
    await client.mailboxOpen("INBOX");

    const messageUids = await client.search({ seen: false });
    if (!messageUids.length) {
      await disposeClient(client);
      return;
    }

    for await (const message of client.fetch(messageUids, {
      uid: true,
      envelope: true,
      source: true,
      flags: true,
    })) {
      try {
        const parsed = await simpleParser(message.source);
        const subject = parsed.subject || message.envelope?.subject || "";
        const protocol = extractProtocol(subject);
        const fromEmail = parsed.from?.value?.[0]?.address?.toLowerCase() || "";
        const fromName = parsed.from?.value?.[0]?.name || "";
        const messageId = parsed.messageId || message.envelope?.messageId || `${subject}_${message.uid}`;

        if (await wasInboundMessageProcessed(messageId)) {
          await client.messageFlagsAdd(message.uid, ["\\Seen"]);
          continue;
        }

        if (!protocol) {
          await markInboundMessageProcessed({
            messageId,
            protocol: null,
            status: "ignored_no_protocol",
            fromEmail,
            subject,
          });
          await client.messageFlagsAdd(message.uid, ["\\Seen"]);
          continue;
        }

        if (!fromEmail || (SUPPORT_INBOX && fromEmail === SUPPORT_INBOX)) {
          await markInboundMessageProcessed({
            messageId,
            protocol,
            status: "ignored_support_sender",
            fromEmail,
            subject,
          });
          await client.messageFlagsAdd(message.uid, ["\\Seen"]);
          continue;
        }

        const textBody = stripQuotedReply(parsed.text || parsed.html || "");
        if (!textBody) {
          await markInboundMessageProcessed({
            messageId,
            protocol,
            status: "ignored_empty_body",
            fromEmail,
            subject,
          });
          await client.messageFlagsAdd(message.uid, ["\\Seen"]);
          continue;
        }

        const snapshot = await db
          .collection("support_tickets")
          .where("protocol", "==", protocol)
          .limit(1)
          .get();

        if (snapshot.empty) {
          await markInboundMessageProcessed({
            messageId,
            protocol,
            status: "ignored_ticket_not_found",
            fromEmail,
            subject,
          });
          await client.messageFlagsAdd(message.uid, ["\\Seen"]);
          continue;
        }

        const doc = snapshot.docs[0];
        const ticket = { id: doc.id, ref: doc.ref, ...doc.data() };
        await appendInboundReplyToTicket({
          ticket,
          replyText: textBody,
          fromEmail,
          fromName,
          messageId,
        });
        await client.messageFlagsAdd(message.uid, ["\\Seen"]);
      } catch (error) {
        logger.error("Support inbox email processing failed: %s", error.message || error);
      }
    }

    await disposeClient(client);
  } catch (error) {
    logger.warn("Support inbox polling failed: %s", error.message || error);
    await disposeClient(client);
  }
};

const pollSupportInbox = async () => {
  if (!started) {
    pollingTimeout = null;
    return;
  }

  if (polling) {
    pollingTimeout = setTimeout(pollSupportInbox, POLL_INTERVAL_MS);
    return;
  }

  polling = true;
  try {
    await processMailbox();
  } finally {
    polling = false;
    if (started) {
      pollingTimeout = setTimeout(pollSupportInbox, POLL_INTERVAL_MS);
    } else {
      pollingTimeout = null;
    }
  }
};

const startSupportInboxListener = () => {
  if (started || !hasInboxConfig()) return;
  started = true;
  pollSupportInbox();
  logger.info("Support inbox listener ativo");
};

const stopSupportInboxListener = () => {
  started = false;
  polling = false;
  if (pollingTimeout) {
    clearTimeout(pollingTimeout);
    pollingTimeout = null;
  }
  if (activeClient) {
    try {
      activeClient.close();
    } catch (_) {}
    activeClient = null;
  }
};

module.exports = {
  startSupportInboxListener,
  stopSupportInboxListener,
};