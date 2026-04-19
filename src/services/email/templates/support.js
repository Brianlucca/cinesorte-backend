const env = require("../../../config/env");
const { buildEmailLayout } = require("./layout");
const {
  buildConversationList,
  buildSupportEmailSubject,
  formatBahiaDateTime,
  normalizeConversation,
} = require("../utils");
const { getSupportInbox } = require("../transport");

const appUrl = env.FRONTEND_URL.replace(/\/$/, "");
const supportUrl = `${appUrl}/app/settings`;

const buildSupportTicketReceivedEmail = ({ protocol, userEmail, userName, subjectLabel, createdAt, originalMessage }) => {
  const createdAtLabel = formatBahiaDateTime(createdAt || new Date());
  const displayName = userName || "cinéfilo";
  const subject = buildSupportEmailSubject(protocol);

  const text = [
    `Olá, ${displayName}.`,
    "",
    `Recebemos o seu chamado ${protocol} no CineSorte.`,
    `Assunto: ${subjectLabel || "Suporte"}`,
    `Enviado em: ${createdAtLabel}`,
    originalMessage ? "" : null,
    originalMessage ? `Mensagem enviada: ${originalMessage}` : null,
    "",
    "Guarde esse protocolo. Você pode acompanhar o status na área de suporte do seu perfil.",
    "",
    supportUrl,
    "",
    "Equipe CineSorte",
  ]
    .filter(Boolean)
    .join("\n");

  const html = buildEmailLayout({
    title: "Chamado recebido com sucesso",
    intro: `Olá, ${displayName}. Recebemos o seu chamado e ele já entrou na fila da equipe do CineSorte.`,
    eyebrow: "Suporte CineSorte",
    heroLabel: "Protocolo em andamento",
    theme: "notice",
    actions: [{ label: "Acompanhar protocolo", href: supportUrl }],
    sections: [
      {
        type: "list",
        title: "Resumo do chamado",
        items: [
          `Protocolo: ${protocol}`,
          `Assunto: ${subjectLabel || "Suporte"}`,
          `Enviado em: ${createdAtLabel}`,
        ],
      },
      originalMessage
        ? {
            title: "Mensagem enviada",
            body: originalMessage,
          }
        : null,
    ],
    outro: "Guarde esse protocolo. Você pode acompanhar o status na área de suporte do seu perfil.",
    footerNote: "Este email foi enviado automaticamente após a abertura do chamado.",
  });

  return {
    to: userEmail,
    subject,
    text,
    html,
    logLabel: "support_ticket_received_email",
    replyTo: getSupportInbox(),
  };
};

const buildSupportInboxTicketCreatedEmail = ({ protocol, userEmail, userName, username, message, subjectLabel, createdAt }) => {
  const createdAtLabel = formatBahiaDateTime(createdAt || new Date());
  const displayName = userName || "Usuário";

  const text = [
    "Novo chamado recebido no CineSorte.",
    "",
    `Protocolo: ${protocol}`,
    `Assunto: ${subjectLabel || "Suporte"}`,
    `Nome: ${displayName}`,
    `Username: @${username || "desconhecido"}`,
    `Email: ${userEmail || "não informado"}`,
    `Data: ${createdAtLabel}`,
    "",
    "Mensagem:",
    message || "Sem mensagem.",
  ].join("\n");

  const html = buildEmailLayout({
    title: "Novo chamado de suporte",
    intro: "A equipe do CineSorte recebeu um novo chamado e ele já está salvo no sistema.",
    eyebrow: "Painel interno",
    heroLabel: "Novo protocolo",
    theme: "notice",
    sections: [
      {
        type: "list",
        title: "Dados principais",
        items: [
          `Protocolo: ${protocol}`,
          `Assunto: ${subjectLabel || "Suporte"}`,
          `Nome: ${displayName}`,
          `Username: @${username || "desconhecido"}`,
          `Email: ${userEmail || "não informado"}`,
          `Data: ${createdAtLabel}`,
        ],
      },
      {
        title: "Mensagem",
        body: message || "Sem mensagem.",
      },
    ],
  });

  return {
    to: getSupportInbox(),
    subject: `[${protocol}] Novo chamado de suporte`,
    text,
    html,
    logLabel: "support_ticket_inbox_email",
    replyTo: userEmail || undefined,
    priority: "high",
  };
};

const buildSupportInboxThreadStartEmail = ({
  protocol,
  userEmail,
  userName,
  username,
  message,
  subjectLabel,
  createdAt,
}) => {
  const createdAtLabel = formatBahiaDateTime(createdAt || new Date());
  const displayName = userName || username || "Usuário";
  const subject = buildSupportEmailSubject(protocol);

  const text = [
    "A thread interna deste atendimento foi iniciada.",
    "",
    `Protocolo: ${protocol}`,
    `Assunto: ${subjectLabel || "Suporte"}`,
    `Usuário: ${displayName}`,
    `Username: @${username || "desconhecido"}`,
    `Email: ${userEmail || "não informado"}`,
    `Aberto em: ${createdAtLabel}`,
    "",
    "Mensagem inicial:",
    message || "Sem mensagem.",
  ].join("\n");

  const html = buildEmailLayout({
    title: "Thread interna iniciada",
    intro: "A conversa principal do suporte foi iniciada e as próximas respostas ficarão agrupadas aqui.",
    eyebrow: "Painel interno",
    heroLabel: "Atendimento CineSorte",
    theme: "notice",
    sections: [
      {
        type: "list",
        title: "Dados principais",
        items: [
          `Protocolo: ${protocol}`,
          `Assunto: ${subjectLabel || "Suporte"}`,
          `Usuário: ${displayName}`,
          `Username: @${username || "desconhecido"}`,
          `Email: ${userEmail || "não informado"}`,
          `Aberto em: ${createdAtLabel}`,
        ],
      },
      {
        title: "Mensagem inicial",
        body: message || "Sem mensagem.",
      },
    ],
  });

  return {
    to: getSupportInbox(),
    subject,
    text,
    html,
    logLabel: "support_ticket_inbox_thread_email",
    replyTo: userEmail || undefined,
    priority: "high",
  };
};

const buildSupportTicketReplyEmail = ({
  protocol,
  userEmail,
  userName,
  subjectLabel,
  adminResponse,
  respondedAt,
  threadMessageId,
  conversation,
  originalMessage,
}) => {
  const respondedAtLabel = formatBahiaDateTime(respondedAt || new Date());
  const displayName = userName || "cinéfilo";
  const replyText = adminResponse || "A equipe do CineSorte enviou uma atualização sobre o seu chamado.";
  const subject = buildSupportEmailSubject(protocol);
  const historyItems = buildConversationList(normalizeConversation(conversation, originalMessage));

  const text = [
    `Olá, ${displayName}.`,
    "",
    `Seu chamado ${protocol} recebeu uma nova resposta da equipe do CineSorte.`,
    `Assunto: ${subjectLabel || "Suporte"}`,
    `Respondido em: ${respondedAtLabel}`,
    "",
    "Resposta da equipe:",
    replyText,
    historyItems.length ? "" : null,
    historyItems.length ? "Histórico do protocolo:" : null,
    ...historyItems,
    "",
    supportUrl,
    "",
    "Equipe CineSorte",
  ]
    .filter(Boolean)
    .join("\n");

  const html = buildEmailLayout({
    title: "Nova resposta no seu chamado",
    intro: `Olá, ${displayName}. A equipe do CineSorte enviou uma atualização sobre o seu protocolo.`,
    eyebrow: "Suporte CineSorte",
    heroLabel: "Atualização do protocolo",
    theme: "notice",
    actions: [{ label: "Abrir suporte no CineSorte", href: supportUrl }],
    sections: [
      {
        type: "list",
        title: "Resumo",
        items: [
          `Protocolo: ${protocol}`,
          `Assunto: ${subjectLabel || "Suporte"}`,
          `Respondido em: ${respondedAtLabel}`,
        ],
      },
      {
        title: "Resposta da equipe",
        body: replyText,
      },
      historyItems.length
        ? {
            type: "list",
            title: "Histórico do protocolo",
            items: historyItems,
          }
        : null,
    ],
    outro: "Você pode responder este email ou acompanhar o protocolo pela área de suporte do seu perfil.",
    footerNote: "Este email foi enviado automaticamente após uma nova resposta da equipe.",
  });

  return {
    to: userEmail,
    subject,
    text,
    html,
    logLabel: "support_ticket_reply_email",
    replyTo: getSupportInbox(),
    threadMessageId,
  };
};

const buildSupportInboxReplyMirrorEmail = ({
  protocol,
  userEmail,
  userName,
  username,
  subjectLabel,
  adminResponse,
  respondedAt,
  threadMessageId,
  conversation,
  originalMessage,
}) => {
  const respondedAtLabel = formatBahiaDateTime(respondedAt || new Date());
  const displayName = userName || username || "Usuário";
  const replyText = adminResponse || "A equipe do CineSorte enviou uma atualização sobre o chamado.";
  const historyItems = buildConversationList(normalizeConversation(conversation, originalMessage));

  const text = [
    "Atualização enviada ao usuário.",
    "",
    `Protocolo: ${protocol}`,
    `Assunto: ${subjectLabel || "Suporte"}`,
    `Usuário: ${displayName}`,
    `Username: @${username || "desconhecido"}`,
    `Email: ${userEmail || "não informado"}`,
    `Respondido em: ${respondedAtLabel}`,
    "",
    "Resposta enviada:",
    replyText,
    historyItems.length ? "" : null,
    historyItems.length ? "Histórico do protocolo:" : null,
    ...historyItems,
  ]
    .filter(Boolean)
    .join("\n");

  const html = buildEmailLayout({
    title: "Resposta enviada no suporte",
    intro: "Uma nova resposta foi enviada ao usuário e uma cópia interna foi registrada.",
    eyebrow: "Painel interno",
    heroLabel: "Resposta do protocolo",
    theme: "notice",
    sections: [
      {
        type: "list",
        title: "Dados principais",
        items: [
          `Protocolo: ${protocol}`,
          `Assunto: ${subjectLabel || "Suporte"}`,
          `Usuário: ${displayName}`,
          `Username: @${username || "desconhecido"}`,
          `Email: ${userEmail || "não informado"}`,
          `Respondido em: ${respondedAtLabel}`,
        ],
      },
      {
        title: "Resposta enviada",
        body: replyText,
      },
      historyItems.length
        ? {
            type: "list",
            title: "Histórico do protocolo",
            items: historyItems,
          }
        : null,
    ],
  });

  return {
    to: getSupportInbox(),
    subject: buildSupportEmailSubject(protocol),
    text,
    html,
    logLabel: "support_ticket_reply_inbox_email",
    replyTo: userEmail || undefined,
    threadMessageId,
    priority: "high",
  };
};

const buildSupportTicketClosedEmail = ({
  protocol,
  userEmail,
  userName,
  subjectLabel,
  resolutionNote,
  closedAt,
  threadMessageId,
  conversation,
  originalMessage,
}) => {
  const closedAtLabel = formatBahiaDateTime(closedAt || new Date());
  const displayName = userName || "cinéfilo";
  const summary = resolutionNote || "Seu chamado foi analisado e finalizado pela equipe do CineSorte.";
  const subject = buildSupportEmailSubject(protocol);
  const historyItems = buildConversationList(normalizeConversation(conversation, originalMessage));

  const text = [
    `Olá, ${displayName}.`,
    "",
    `Seu chamado ${protocol} foi finalizado no CineSorte.`,
    `Assunto: ${subjectLabel || "Suporte"}`,
    `Data de encerramento: ${closedAtLabel}`,
    "",
    "Resumo do encerramento:",
    summary,
    historyItems.length ? "" : null,
    historyItems.length ? "Histórico do protocolo:" : null,
    ...historyItems,
    "",
    "Se precisar, você pode abrir um novo chamado na área de suporte do CineSorte.",
    supportUrl,
    "",
    "Equipe CineSorte",
  ]
    .filter(Boolean)
    .join("\n");

  const html = buildEmailLayout({
    title: "Chamado finalizado",
    intro: `Olá, ${displayName}. Seu chamado foi analisado e finalizado pela equipe do CineSorte.`,
    eyebrow: "Suporte CineSorte",
    heroLabel: "Encerramento do protocolo",
    theme: "notice",
    actions: [{ label: "Abrir suporte no CineSorte", href: supportUrl }],
    sections: [
      {
        type: "list",
        title: "Resumo do encerramento",
        items: [
          `Protocolo: ${protocol}`,
          `Assunto: ${subjectLabel || "Suporte"}`,
          `Data de encerramento: ${closedAtLabel}`,
        ],
      },
      {
        title: "Resumo",
        body: summary,
      },
      historyItems.length
        ? {
            type: "list",
            title: "Histórico do protocolo",
            items: historyItems,
          }
        : null,
    ],
    outro: "Se precisar, você pode abrir um novo chamado na área de suporte do CineSorte.",
    footerNote: "Este email foi enviado automaticamente após o encerramento do chamado.",
  });

  return {
    to: userEmail,
    subject,
    text,
    html,
    logLabel: "support_ticket_closed_email",
    replyTo: getSupportInbox(),
    threadMessageId,
  };
};

const buildSupportInboxClosedMirrorEmail = ({
  protocol,
  userEmail,
  userName,
  username,
  subjectLabel,
  resolutionNote,
  closedAt,
  threadMessageId,
  conversation,
  originalMessage,
}) => {
  const closedAtLabel = formatBahiaDateTime(closedAt || new Date());
  const displayName = userName || username || "Usuário";
  const summary = resolutionNote || "Seu chamado foi analisado e finalizado pela equipe do CineSorte.";
  const historyItems = buildConversationList(normalizeConversation(conversation, originalMessage));

  const text = [
    "Encerramento enviado ao usuário.",
    "",
    `Protocolo: ${protocol}`,
    `Assunto: ${subjectLabel || "Suporte"}`,
    `Usuário: ${displayName}`,
    `Username: @${username || "desconhecido"}`,
    `Email: ${userEmail || "não informado"}`,
    `Encerrado em: ${closedAtLabel}`,
    "",
    "Resumo do encerramento:",
    summary,
    historyItems.length ? "" : null,
    historyItems.length ? "Histórico do protocolo:" : null,
    ...historyItems,
  ]
    .filter(Boolean)
    .join("\n");

  const html = buildEmailLayout({
    title: "Chamado encerrado",
    intro: "O encerramento do protocolo foi enviado ao usuário e uma cópia interna foi registrada.",
    eyebrow: "Painel interno",
    heroLabel: "Encerramento do protocolo",
    theme: "notice",
    sections: [
      {
        type: "list",
        title: "Dados principais",
        items: [
          `Protocolo: ${protocol}`,
          `Assunto: ${subjectLabel || "Suporte"}`,
          `Usuário: ${displayName}`,
          `Username: @${username || "desconhecido"}`,
          `Email: ${userEmail || "não informado"}`,
          `Encerrado em: ${closedAtLabel}`,
        ],
      },
      {
        title: "Resumo do encerramento",
        body: summary,
      },
      historyItems.length
        ? {
            type: "list",
            title: "Histórico do protocolo",
            items: historyItems,
          }
        : null,
    ],
  });

  return {
    to: getSupportInbox(),
    subject: buildSupportEmailSubject(protocol),
    text,
    html,
    logLabel: "support_ticket_closed_inbox_email",
    replyTo: userEmail || undefined,
    threadMessageId,
    priority: "high",
  };
};

module.exports = {
  buildSupportInboxTicketCreatedEmail,
  buildSupportInboxThreadStartEmail,
  buildSupportInboxReplyMirrorEmail,
  buildSupportInboxClosedMirrorEmail,
  buildSupportTicketClosedEmail,
  buildSupportTicketReceivedEmail,
  buildSupportTicketReplyEmail,
};
