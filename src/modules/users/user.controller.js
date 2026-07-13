const { db, admin } = require("../../config/firebase");
const catchAsync = require("../../shared/utils/catchAsync");
const AppError = require("../../shared/errors/AppError");
const logger = require("../../shared/utils/logger");
const { SUBJECT_LABELS, notifySupportTicketCreated } = require("../support/supportDelivery.service");
const { CURRENT_TERMS_VERSION } = require("../../config/legal");

const SUPPORT_COOLDOWN_MS = 24 * 60 * 60 * 1000;

function buildSupportProtocol(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `CS-${year}${month}${day}-${suffix}`;
}

function serializeDate(value) {
  if (!value) return null;
  if (typeof value?.toDate === "function") return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  return value;
}

function serializeConversation(conversation = []) {
  return conversation.map((entry) => ({
    ...entry,
    createdAt: serializeDate(entry.createdAt),
  }));
}

function buildClientSupportTicket(ticket = {}, docId = null) {
  return {
    ...(docId ? { id: docId } : {}),
    protocol: ticket.protocol || null,
    subject: ticket.subject || null,
    subjectLabel: ticket.subjectLabel || SUBJECT_LABELS[ticket.subject] || ticket.subject || null,
    status: ticket.status || "open",
    message: ticket.message || "",
    resolutionNote: ticket.resolutionNote || null,
    adminResponse: ticket.adminResponse || null,
    conversation: serializeConversation(ticket.conversation || []),
    createdAt: serializeDate(ticket.createdAt),
    updatedAt: serializeDate(ticket.updatedAt),
    closedAt: serializeDate(ticket.closedAt),
    adminRespondedAt: serializeDate(ticket.adminRespondedAt),
  };
}

exports.searchUsers = catchAsync(async (req, res, next) => {
  const { query } = req.query;
  if (!query || query.length < 3) return res.status(200).json([]);

  const snapshot = await db
    .collection("users")
    .where("username", ">=", query.toLowerCase())
    .where("username", "<=", query.toLowerCase() + "\uf8ff")
    .limit(10)
    .get();

  const users = snapshot.docs.map((doc) => ({
    name: doc.data().name,
    username: doc.data().username,
    photoURL: doc.data().photoURL,
  }));
  res.status(200).json(users);
});

exports.getUserProfile = catchAsync(async (req, res, next) => {
  const { username } = req.params;
  const snapshot = await db.collection("users").where("username", "==", username).limit(1).get();
  if (snapshot.empty) return next(new AppError("Usuário não encontrado", 404));

  const userDoc = snapshot.docs[0];
  const userData = userDoc.data();

  res.status(200).json({
    name: userData.name,
    username: userData.username,
    photoURL: userData.photoURL,
    backgroundURL: userData.backgroundURL,
    bio: userData.bio,
    level: userData.level || 1,
    levelTitle: userData.levelTitle || "Espectador",
    totalXp: userData.totalXp || 0,
    reviewsCount: userData.reviewsCount || 0,
    watchedCount: userData.watchedCount || 0,
    followersCount: userData.followersCount || 0,
    followingCount: userData.followingCount || 0,
    createdAt: userData.createdAt,
    trophies: userData.trophies || [],
    genreCounts: userData.genreCounts || {},
  });
});

exports.acceptTerms = catchAsync(async (req, res, next) => {
  const { uid } = req.user;
  const { version } = req.body;

  if (version !== CURRENT_TERMS_VERSION) {
    return next(new AppError("Versão dos termos inválida ou desatualizada.", 400));
  }

  await db.collection("users").doc(uid).update({
    termsVersion: version,
    termsAcceptedAt: new Date(),
    termsAcceptedUserAgent: req.headers["user-agent"] || "unknown",
  });
  res.status(200).json({ message: "Termos aceitos." });
});

exports.createSupportTicket = catchAsync(async (req, res, next) => {
  const { uid, email, username } = req.user;
  const { subject, message } = req.body;

  if (!email) {
    return next(new AppError("Não foi possível identificar o email da sua conta.", 400));
  }

  const userRef = db.collection("users").doc(uid);
  const userDoc = await userRef.get();

  if (!userDoc.exists) {
    return next(new AppError("Usuário não encontrado.", 404));
  }

  const userData = userDoc.data() || {};
  const now = admin.firestore.Timestamp.now();
  const lastSupportTicketAt = userData.supportLastTicketAt?.toDate ? userData.supportLastTicketAt.toDate() : null;

  if (lastSupportTicketAt) {
    const elapsed = now.toDate().getTime() - lastSupportTicketAt.getTime();

    if (elapsed < SUPPORT_COOLDOWN_MS) {
      const remainingMs = SUPPORT_COOLDOWN_MS - elapsed;
      const remainingHours = Math.ceil(remainingMs / (60 * 60 * 1000));
      return next(
        new AppError(
          `Você já abriu um chamado nas últimas 24 horas. Tente novamente em cerca de ${remainingHours} hora(s).`,
          429
        )
      );
    }
  }

  const protocol = buildSupportProtocol(now.toDate());
  const ticketRef = db.collection("support_tickets").doc();
  const subjectLabel = SUBJECT_LABELS[subject] || subject;
  const userConversationEntry = {
    id: `user_${now.toMillis()}`,
    role: "user",
    author: userData.username || username || "Você",
    channel: "web",
    message,
    createdAt: now,
  };

  const batch = db.batch();
  batch.set(ticketRef, {
    protocol,
    userId: uid,
    email,
    username: userData.username || username || null,
    name: userData.name || null,
    subject,
    subjectLabel,
    status: "open",
    message,
    conversation: [userConversationEntry],
    createdAt: now,
    updatedAt: now,
    closedAt: null,
    closedBy: null,
    resolutionNote: null,
    adminResponse: null,
      adminRespondedAt: null,
      adminRespondedBy: null,
      supportThreadMessageId: null,
      supportInboxThreadMessageId: null,
    });
  batch.update(userRef, {
    supportLastTicketAt: now,
  });
  await batch.commit();

  try {
    const notifications = await notifySupportTicketCreated({
      protocol,
      subjectCode: subject,
      userName: userData.name || username || "Usuário",
      userEmail: email,
      username: userData.username || username || null,
      message,
      createdAt: now.toDate(),
    });

    const threadUpdates = {};
    if (notifications?.userConfirmation?.messageId) {
      threadUpdates.supportThreadMessageId = notifications.userConfirmation.messageId;
    }
    if (notifications?.supportInboxThread?.messageId) {
      threadUpdates.supportInboxThreadMessageId = notifications.supportInboxThread.messageId;
    }
    if (Object.keys(threadUpdates).length > 0) {
      await ticketRef.update(threadUpdates);
    }
  } catch (error) {
    logger.error("support ticket notifications failed: %s", error.message || error);
  }

  const ticket = buildClientSupportTicket(
    {
      protocol,
      subject,
      subjectLabel,
      status: "open",
      message,
      conversation: [userConversationEntry],
      createdAt: now,
      updatedAt: now,
      closedAt: null,
      resolutionNote: null,
      adminResponse: null,
      adminRespondedAt: null,
    },
    ticketRef.id
  );

  return res.status(201).json({
    message: "Chamado enviado com sucesso.",
    ticket,
  });
});

exports.getMySupportTickets = catchAsync(async (req, res) => {
  const { uid } = req.user;

  const snapshot = await db.collection("support_tickets").where("userId", "==", uid).get();

  const tickets = snapshot.docs
    .map((doc) => buildClientSupportTicket(doc.data(), doc.id))
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
    .slice(0, 20);

  res.status(200).json(tickets);
});
