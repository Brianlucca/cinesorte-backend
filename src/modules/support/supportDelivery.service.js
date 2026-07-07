const SUBJECT_LABELS = {
  SUGESTAO: "Feedback / Sugestão",
  BUG_REPORT: "Relatar um Erro (Bug)",
  PROBLEMA_CONTA: "Problemas com a Conta",
  DENUNCIA: "Denúncia",
  OUTRO_ASSUNTO: "Outros Assuntos",
};

const skippedEmailResult = { skipped: true, sent: false, reason: "custom_email_disabled" };

const notifySupportTicketCreated = async ({ subjectCode }) => ({
  subjectLabel: SUBJECT_LABELS[subjectCode] || subjectCode || "Suporte",
  userConfirmation: skippedEmailResult,
  supportInbox: skippedEmailResult,
  supportInboxThread: skippedEmailResult,
});

module.exports = {
  SUBJECT_LABELS,
  notifySupportTicketCreated,
};
