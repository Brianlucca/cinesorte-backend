const logger = require("../utils/logger");
const {
  sendSupportInboxThreadStartEmail,
  sendSupportTicketReceivedEmail,
  sendSupportInboxTicketCreatedEmail,
} = require("./email");

const SUBJECT_LABELS = {
  SUGESTAO: "Feedback / Sugestão",
  BUG_REPORT: "Relatar um Erro (Bug)",
  PROBLEMA_CONTA: "Problemas com a Conta",
  DENUNCIA: "Denúncia",
  OUTRO_ASSUNTO: "Outros Assuntos",
};

const notifySupportTicketCreated = async ({
  protocol,
  subjectCode,
  userName,
  userEmail,
  username,
  message,
  createdAt,
}) => {
  const subjectLabel = SUBJECT_LABELS[subjectCode] || subjectCode || "Suporte";

  const [userResult, supportInboxResult, supportInboxThreadResult] = await Promise.all([
    sendSupportTicketReceivedEmail({
      protocol,
      userEmail,
      userName,
      subjectLabel,
      createdAt,
      originalMessage: message,
    }),
    sendSupportInboxTicketCreatedEmail({
      protocol,
      userEmail,
      userName,
      username,
      message,
      subjectLabel,
      createdAt,
    }),
    sendSupportInboxThreadStartEmail({
      protocol,
      userEmail,
      userName,
      username,
      message,
      subjectLabel,
      createdAt,
    }),
  ]);

  if (userResult?.sent === false) {
    logger.error("support user confirmation email failed: %s", userResult.error || "unknown_error");
  }

  if (supportInboxResult?.sent === false) {
    logger.error("support inbox email failed: %s", supportInboxResult.error || "unknown_error");
  }

  if (supportInboxThreadResult?.sent === false) {
    logger.error("support inbox thread email failed: %s", supportInboxThreadResult.error || "unknown_error");
  }

  return {
    subjectLabel,
    userConfirmation: userResult,
    supportInbox: supportInboxResult,
    supportInboxThread: supportInboxThreadResult,
  };
};

module.exports = {
  SUBJECT_LABELS,
  notifySupportTicketCreated,
};
