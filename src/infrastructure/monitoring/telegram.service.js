const axios = require("axios");
const env = require("../../config/env");
const os = require("os");
const logger = require("../../shared/utils/logger");
const { db, admin } = require("../../config/firebase");

let alertsActive = true;
let alertsSilencedUntil = null;
let lastUpdateId = 0;
let pollingTimeout = null;
let memoryWatchInterval = null;
let dailyReportInterval = null;
let started = false;
let pollRequestInFlight = false;
let telegramConflictUntil = 0;

const POLL_RETRY_MS = 2000;
const TELEGRAM_MESSAGE_LIMIT = 3900;
const TELEGRAM_CHAT_ID = String(env.TELEGRAM_CHAT_ID);

const formatTelegramError = (error) => {
  if (!error) return "unknown telegram error";

  const status = error.response?.status;
  const payload = error.response?.data;
  const message =
    payload?.description ||
    payload?.error_code ||
    error.message ||
    "telegram request failed";

  if (payload) {
    return `Telegram error${status ? ` ${status}` : ""}: ${message} | payload=${JSON.stringify(payload)}`;
  }

  return `Telegram error${status ? ` ${status}` : ""}: ${message}`;
};

const escapeHtml = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");

const getBahiaDateTime = (date = new Date()) =>
  new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Bahia",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);

const getBahiaHourAndMinute = (date = new Date()) => {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/Bahia",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);

  return {
    hour: Number(parts.find((part) => part.type === "hour")?.value || 0),
    minute: Number(parts.find((part) => part.type === "minute")?.value || 0),
  };
};

const isAlertsMuted = () => Boolean(alertsSilencedUntil && alertsSilencedUntil.getTime() > Date.now());

const ensureAlertState = () => {
  if (alertsSilencedUntil && alertsSilencedUntil.getTime() <= Date.now()) {
    alertsSilencedUntil = null;
  }
};

const getAlertsStatusLabel = () => {
  if (!alertsActive) return "desativados manualmente";
  if (isAlertsMuted()) return `silenciados até ${getBahiaDateTime(alertsSilencedUntil)}`;
  return "ativos";
};

const splitMessage = (message) => {
  if (message.length <= TELEGRAM_MESSAGE_LIMIT) return [message];

  const chunks = [];
  let remaining = message;

  while (remaining.length > TELEGRAM_MESSAGE_LIMIT) {
    let boundary = remaining.lastIndexOf("\n", TELEGRAM_MESSAGE_LIMIT);
    if (boundary < TELEGRAM_MESSAGE_LIMIT * 0.5) boundary = TELEGRAM_MESSAGE_LIMIT;
    chunks.push(remaining.slice(0, boundary));
    remaining = remaining.slice(boundary).trimStart();
  }

  if (remaining.length) chunks.push(remaining);
  return chunks;
};

const sendTelegramMessage = async (message) => {
  try {
    const url = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`;
    const chunks = splitMessage(message);

    for (const chunk of chunks) {
      await axios.post(url, {
        chat_id: TELEGRAM_CHAT_ID,
        text: chunk,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      });
    }
  } catch (error) {
    logger.error("%s", formatTelegramError(error));
  }
};

const buildPanelMessage = (title, bodyLines = []) => {
  const header = [
    `<b>CineSorte Monitor</b>`,
    `<b>${escapeHtml(title)}</b>`,
    `<i>${escapeHtml(getBahiaDateTime())} - America/Bahia</i>`,
    "",
  ];

  return [...header, ...bodyLines].join("\n");
};

const sendAlert = async (message) => {
  ensureAlertState();
  if (!alertsActive || isAlertsMuted()) return;
  await sendTelegramMessage(buildPanelMessage("Alerta do sistema", [escapeHtml(message)]));
};

const getHelpMessage = () =>
  buildPanelMessage("Comandos disponíveis", [
    "/today - atividade das últimas 24 horas",
    "/report - relatório completo sob demanda",
    "/support - lista protocolos abertos",
    "/ticket CS-AAAA - detalhes de um protocolo",
    "/reply CS-AAAA mensagem - responde um chamado",
    "/close CS-AAAA mensagem opcional - fecha um chamado",
    "/help - exibe esta ajuda",
  ]);

const setupBotCommands = async () => {
  try {
    const url = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/setMyCommands`;
    await axios.post(url, {
      commands: [
        { command: "today", description: "Atividade das últimas 24h" },
        { command: "report", description: "Relatório sob demanda" },
        { command: "support", description: "Lista protocolos de suporte" },
        { command: "ticket", description: "Detalhes de um protocolo" },
        { command: "reply", description: "Responde um protocolo" },
        { command: "close", description: "Fecha um protocolo" },
        { command: "help", description: "Lista de comandos" },
      ],
    });
  } catch (error) {
    logger.error("%s", formatTelegramError(error));
  }
};

const getCollectionCount = async (collectionName, filters = []) => {
  let ref = db.collection(collectionName);
  for (const filter of filters) {
    ref = ref.where(filter.field, filter.operator, filter.value);
  }
  const snapshot = await ref.count().get();
  return snapshot.data().count || 0;
};

const getSinceDate = (hours) => new Date(Date.now() - hours * 60 * 60 * 1000);

const getGrowthMetrics = async () => {
  const since = getSinceDate(24);

  const [newUsers, newReviews, newComments, newListShares, openSupportTickets] = await Promise.all([
    getCollectionCount("users", [{ field: "createdAt", operator: ">=", value: since }]),
    getCollectionCount("reviews", [{ field: "createdAt", operator: ">=", value: since }]),
    getCollectionCount("comments", [{ field: "createdAt", operator: ">=", value: since }]),
    getCollectionCount("shared_lists", [{ field: "createdAt", operator: ">=", value: since }]),
    getCollectionCount("support_tickets", [{ field: "status", operator: "==", value: "open" }]),
  ]);

  return { newUsers, newReviews, newComments, newListShares, openSupportTickets };
};

const getTotalMetrics = async () => {
  const [totalUsers, totalReviews, totalComments, totalListShares] = await Promise.all([
    getCollectionCount("users"),
    getCollectionCount("reviews"),
    getCollectionCount("comments"),
    getCollectionCount("shared_lists"),
  ]);

  return { totalUsers, totalReviews, totalComments, totalListShares };
};

const getSystemMetrics = () => {
  const freeMemGb = (os.freemem() / 1024 / 1024 / 1024).toFixed(2);
  const totalMemGb = (os.totalmem() / 1024 / 1024 / 1024).toFixed(2);
  const heapUsedMb = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2);
  const rssMb = (process.memoryUsage().rss / 1024 / 1024).toFixed(2);
  const uptimeMinutes = Math.floor(process.uptime() / 60);
  const load = os.loadavg().map((value) => value.toFixed(2));

  return {
    freeMemGb,
    totalMemGb,
    heapUsedMb,
    rssMb,
    uptimeMinutes,
    load,
    node: process.version,
    platform: process.platform,
  };
};

const sendDailyReport = async () => {
  let growth = null;
  let totals = null;

  try {
    [growth, totals] = await Promise.all([getGrowthMetrics(), getTotalMetrics()]);
  } catch (error) {
    logger.error("Telegram daily report failed: %s", error.message || error);
  }

  const system = getSystemMetrics();
  const body = [
    `<b>Servidor</b>`,
    `- Uptime: ${system.uptimeMinutes} min`,
    `- RAM livre: ${system.freeMemGb} GB / ${system.totalMemGb} GB`,
    `- Heap usado: ${system.heapUsedMb} MB`,
    `- RSS: ${system.rssMb} MB`,
    `- CPU load: ${system.load.join(" / ")}`,
    "",
    `<b>Crescimento nas últimas 24 horas</b>`,
    `- Novos usuários: ${growth?.newUsers ?? "-"}`,
    `- Novas reviews: ${growth?.newReviews ?? "-"}`,
    `- Novos comentários: ${growth?.newComments ?? "-"}`,
    `- Novos compartilhamentos de lista: ${growth?.newListShares ?? "-"}`,
    `- Chamados abertos: ${growth?.openSupportTickets ?? "-"}`,
    "",
    `<b>Total acumulado</b>`,
    `- Usuários: ${totals?.totalUsers ?? "-"}`,
    `- Reviews: ${totals?.totalReviews ?? "-"}`,
    `- Comentários: ${totals?.totalComments ?? "-"}`,
    `- Compartilhamentos de lista: ${totals?.totalListShares ?? "-"}`,
    "",
    `<b>Alertas</b>`,
    `- Estado: ${escapeHtml(getAlertsStatusLabel())}`,
  ];

  const originalAlerts = alertsActive;
  const originalSilence = alertsSilencedUntil;
  alertsActive = true;
  alertsSilencedUntil = null;
  await sendTelegramMessage(buildPanelMessage("Relatório diário", body));
  alertsActive = originalAlerts;
  alertsSilencedUntil = originalSilence;
};

const clearBotWork = () => {
  if (pollingTimeout) {
    clearTimeout(pollingTimeout);
    pollingTimeout = null;
  }
  if (memoryWatchInterval) {
    clearInterval(memoryWatchInterval);
    memoryWatchInterval = null;
  }
  if (dailyReportInterval) {
    clearInterval(dailyReportInterval);
    dailyReportInterval = null;
  }
};

const scheduleDailyReport = () => {
  dailyReportInterval = setInterval(() => {
    const { hour, minute } = getBahiaHourAndMinute();
    if (hour === 8 && minute === 0) sendDailyReport();
  }, 60000);
};

const parseSilenceDurationMs = (rawValue) => {
  const value = String(rawValue || "").trim().toLowerCase();
  const match = value.match(/^(\d+)(m|h|d)$/);
  if (!match) return null;

  const amount = Number(match[1]);
  const unit = match[2];
  const multipliers = {
    m: 60000,
    h: 60 * 60000,
    d: 24 * 60 * 60000,
  };

  return amount * multipliers[unit];
};

const getTopUsers = () => {
  const { userTracker } = require("../../shared/middleware/security");
  return [...userTracker.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 5)
    .map(([user, data], index) => `${index + 1}. @${escapeHtml(user)} - ${data.count} req/min`);
};

const normalizeProtocol = (value) => String(value || "").trim().toUpperCase();

const getSupportTicketByProtocol = async (protocol) => {
  const snapshot = await db
    .collection("support_tickets")
    .where("protocol", "==", normalizeProtocol(protocol))
    .limit(1)
    .get();

  if (snapshot.empty) return null;

  const doc = snapshot.docs[0];
  return { id: doc.id, ref: doc.ref, ...doc.data() };
};


const listOpenSupportTickets = async (limit = 8) => {
  const snapshot = await db
    .collection("support_tickets")
    .where("status", "==", "open")
    .limit(limit)
    .get();

  return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
};

const formatSupportTicketSummary = (ticket) => {
  const createdAt = ticket.createdAt?.toDate ? getBahiaDateTime(ticket.createdAt.toDate()) : "data indisponível";
  return `- <b>${escapeHtml(ticket.protocol)}</b> | ${escapeHtml(ticket.subjectLabel || ticket.subject || "Sem assunto")} | @${escapeHtml(ticket.username || "desconhecido")} | ${escapeHtml(createdAt)}\n`;
};

const normalizeTicketConversation = (ticket) => {
  if (Array.isArray(ticket.conversation) && ticket.conversation.length > 0) {
    return [...ticket.conversation].sort((a, b) => {
      const first = a?.createdAt?.toDate ? a.createdAt.toDate().getTime() : new Date(a?.createdAt || 0).getTime();
      const second = b?.createdAt?.toDate ? b.createdAt.toDate().getTime() : new Date(b?.createdAt || 0).getTime();
      return first - second;
    });
  }

  const fallback = [];
  if (ticket.message) {
    fallback.push({
      id: `${ticket.protocol}_user`,
      role: "user",
      author: ticket.username || "usuário",
      message: ticket.message,
      createdAt: ticket.createdAt,
    });
  }
  if (ticket.adminResponse) {
    fallback.push({
      id: `${ticket.protocol}_reply`,
      role: "admin",
      author: "Equipe CineSorte",
      message: ticket.adminResponse,
      createdAt: ticket.adminRespondedAt || ticket.updatedAt,
    });
  }
  if (ticket.resolutionNote) {
    fallback.push({
      id: `${ticket.protocol}_close`,
      role: "admin",
      author: "Equipe CineSorte",
      message: ticket.resolutionNote,
      createdAt: ticket.closedAt || ticket.updatedAt,
      isResolution: true,
    });
  }

  return fallback;
};

const formatSupportTicketDetails = (ticket) => {
  const createdAt = ticket.createdAt?.toDate ? getBahiaDateTime(ticket.createdAt.toDate()) : "data indisponível";
  const updatedAt = ticket.updatedAt?.toDate ? getBahiaDateTime(ticket.updatedAt.toDate()) : "data indisponível";
  const closedAt = ticket.closedAt?.toDate ? getBahiaDateTime(ticket.closedAt.toDate()) : null;

  const lines = [
    `- Protocolo: <b>${escapeHtml(ticket.protocol)}</b>`,
    `- Status: ${escapeHtml(ticket.status || "open")}`,
    `- Assunto: ${escapeHtml(ticket.subjectLabel || ticket.subject || "Sem assunto")}`,
    `- Usuário: @${escapeHtml(ticket.username || "desconhecido")}`,
    `- Email: ${escapeHtml(ticket.email || "não informado")}`,
    `- Criado em: ${escapeHtml(createdAt)}`,
    `- Atualizado em: ${escapeHtml(updatedAt)}`,
  ];

  if (closedAt) lines.push(`- Fechado em: ${escapeHtml(closedAt)}`);
  if (ticket.closedBy) lines.push(`- Fechado por: ${escapeHtml(ticket.closedBy)}`);

  const conversation = normalizeTicketConversation(ticket);
  lines.push("", `<b>Histórico</b>`);

  if (!conversation.length) {
    lines.push("Sem mensagens registradas.");
    return lines;
  }

  conversation.forEach((entry, index) => {
    const entryDate = entry?.createdAt?.toDate
      ? getBahiaDateTime(entry.createdAt.toDate())
      : entry?.createdAt
        ? getBahiaDateTime(new Date(entry.createdAt))
        : "data indisponível";
    const label = entry.isResolution ? "Encerramento" : entry.role === "admin" ? "Equipe" : "Usuário";
    lines.push("");
    lines.push(`${index + 1}. <b>${escapeHtml(label)}</b> - ${escapeHtml(entryDate)}`);
    lines.push(escapeHtml(entry.message || "Sem mensagem."));
  });

  return lines;
};

const closeSupportTicket = async (protocol, reason) => {
  const ticket = await getSupportTicketByProtocol(protocol);
  if (!ticket) return { found: false };
  if (ticket.status === "closed") return { found: true, alreadyClosed: true, ticket };

  const now = admin.firestore.Timestamp.now();
  const resolutionNote = reason || "Seu chamado foi analisado e finalizado pela equipe do CineSorte.";
  const resolutionEntry = {
    id: `close_${now.toMillis()}`,
    role: "admin",
    author: "Equipe CineSorte",
    channel: "telegram",
    message: resolutionNote,
    createdAt: now,
    isResolution: true,
  };

  await ticket.ref.update({
    status: "closed",
    updatedAt: now,
    closedAt: now,
    closedBy: "equipe_cinesorte",
    resolutionNote,
    conversation: admin.firestore.FieldValue.arrayUnion(resolutionEntry),
  });

  return {
    found: true,
    alreadyClosed: false,
    ticket: {
      ...ticket,
      status: "closed",
      updatedAt: now,
      closedAt: now,
      closedBy: "equipe_cinesorte",
      resolutionNote,
      conversation: [...(ticket.conversation || []), resolutionEntry],
    },
  };
};

const replySupportTicket = async (protocol, responseText) => {
  const ticket = await getSupportTicketByProtocol(protocol);
  if (!ticket) return { found: false };
  if (!responseText) return { found: true, missingResponse: true, ticket };

  const now = admin.firestore.Timestamp.now();
  const adminEntry = {
    id: `reply_${now.toMillis()}`,
    role: "admin",
    author: "Equipe CineSorte",
    channel: "telegram",
    message: responseText,
    createdAt: now,
  };

  await ticket.ref.update({
    status: ticket.status === "closed" ? "closed" : "answered",
    updatedAt: now,
    adminResponse: responseText,
    adminRespondedAt: now,
    adminRespondedBy: "equipe_cinesorte",
    conversation: admin.firestore.FieldValue.arrayUnion(adminEntry),
  });

  return {
    found: true,
    missingResponse: false,
    ticket: {
      ...ticket,
      status: ticket.status === "closed" ? "closed" : "answered",
      updatedAt: now,
      adminResponse: responseText,
      adminRespondedAt: now,
      adminRespondedBy: "equipe_cinesorte",
      conversation: [...(ticket.conversation || []), adminEntry],
    },
  };
};
const handleTelegramCommand = async (msg, chatId) => {
  if (String(chatId) !== TELEGRAM_CHAT_ID || !msg) return;

  ensureAlertState();
  const trimmed = msg.trim();
  const [command, ...args] = trimmed.split(/\s+/);




  if (command === "/help") {
    await sendTelegramMessage(getHelpMessage());
    return;
  }



  if (command === "/today") {
    try {
      const growth = await getGrowthMetrics();
      await sendTelegramMessage(buildPanelMessage("Atividade das últimas 24 horas", [
        `- Novos usuários: ${growth.newUsers}`,
        `- Novas reviews: ${growth.newReviews}`,
        `- Novos comentários: ${growth.newComments}`,
        `- Novos compartilhamentos de lista: ${growth.newListShares}`,
        `- Chamados abertos: ${growth.openSupportTickets}`,
      ]));
    } catch (error) {
      logger.error("Telegram today failed: %s", error.message || error);
      await sendTelegramMessage(buildPanelMessage("Falha", ["Não foi possível montar o resumo das últimas 24 horas."]));
    }
    return;
  }

  if (command === "/report") {
    await sendDailyReport();
    return;
  }



  if (command === "/support") {
    try {
      const openTickets = await listOpenSupportTickets(8);
      const lines = [`- Chamados abertos no momento: ${openTickets.length}`];

      if (openTickets.length) {
        lines.push("", `<b>Protocolos recentes</b>`);
        openTickets.forEach((ticket) => lines.push(formatSupportTicketSummary(ticket)));
        lines.push("", "Use /ticket PROTOCOLO para ver detalhes.");
      } else {
        lines.push("", "Nenhum chamado aberto no momento.");
      }

      await sendTelegramMessage(buildPanelMessage("Suporte", lines));
    } catch (error) {
      logger.error("Telegram support failed: %s", error.message || error);
      await sendTelegramMessage(buildPanelMessage("Falha", ["Não foi possível consultar os chamados de suporte."]));
    }
    return;
  }

  if (command === "/ticket") {
    const protocol = normalizeProtocol(args[0]);
    if (!protocol) {
      await sendTelegramMessage(buildPanelMessage("Uso do comando", ["Use /ticket CS-AAAA para ver os detalhes do chamado."]));
      return;
    }

    try {
      const ticket = await getSupportTicketByProtocol(protocol);
      if (!ticket) {
        await sendTelegramMessage(buildPanelMessage("Chamado não encontrado", [`- Protocolo: ${escapeHtml(protocol)}`]));
        return;
      }

      await sendTelegramMessage(buildPanelMessage(`Chamado ${ticket.protocol}`, formatSupportTicketDetails(ticket)));
    } catch (error) {
      logger.error("Telegram ticket failed: %s", error.message || error);
      await sendTelegramMessage(buildPanelMessage("Falha", ["Não foi possível consultar esse protocolo."]));
    }
    return;
  }

  if (command === "/reply") {
    const protocol = normalizeProtocol(args[0]);
    const responseText = args.slice(1).join(" ").trim();

    if (!protocol || !responseText) {
      await sendTelegramMessage(buildPanelMessage("Uso do comando", ["Use /reply CS-AAAA mensagem para responder um chamado."]));
      return;
    }

    try {
      const result = await replySupportTicket(protocol, responseText);
      if (!result.found) {
        await sendTelegramMessage(buildPanelMessage("Chamado não encontrado", [`- Protocolo: ${escapeHtml(protocol)}`]));
        return;
      }

      if (result.missingResponse) {
        await sendTelegramMessage(buildPanelMessage("Resposta ausente", ["Envie uma mensagem após o protocolo para responder ao chamado."]));
        return;
      }

      await sendTelegramMessage(buildPanelMessage("Resposta enviada", [
        `- Protocolo: <b>${escapeHtml(result.ticket.protocol)}</b>`,
        `- Status atual: ${escapeHtml(result.ticket.status)}`,
        `- Resposta: ${escapeHtml(result.ticket.adminResponse)}`,
      ]));
    } catch (error) {
      logger.error("Telegram reply ticket failed: %s", error.message || error);
      await sendTelegramMessage(buildPanelMessage("Falha", ["Não foi possível responder esse chamado."]));
    }
    return;
  }
  if (command === "/close") {
    const protocol = normalizeProtocol(args[0]);
    const reason = args.slice(1).join(" ").trim();

    if (!protocol) {
      await sendTelegramMessage(buildPanelMessage("Uso do comando", ["Use /close CS-AAAA mensagem opcional de encerramento para fechar um chamado."]));
      return;
    }

    try {
      const result = await closeSupportTicket(protocol, reason);
      if (!result.found) {
        await sendTelegramMessage(buildPanelMessage("Chamado não encontrado", [`- Protocolo: ${escapeHtml(protocol)}`]));
        return;
      }

      if (result.alreadyClosed) {
        await sendTelegramMessage(buildPanelMessage("Chamado já fechado", [
          `- Protocolo: <b>${escapeHtml(result.ticket.protocol)}</b>`,
          `- Status atual: ${escapeHtml(result.ticket.status || "closed")}`,
        ]));
        return;
      }

      await sendTelegramMessage(buildPanelMessage("Chamado finalizado", [
        `- Protocolo: <b>${escapeHtml(result.ticket.protocol)}</b>`,
        `- Novo status: ${escapeHtml(result.ticket.status)}`,
        `- Resolução: ${escapeHtml(result.ticket.resolutionNote || "Seu chamado foi analisado e finalizado pela equipe do CineSorte.")}`,
      ]));
    } catch (error) {
      logger.error("Telegram close ticket failed: %s", error.message || error);
      await sendTelegramMessage(buildPanelMessage("Falha", ["Não foi possível fechar esse chamado."]));
    }
    return;
  }


  await sendTelegramMessage(buildPanelMessage("Comando não reconhecido", [
    `- Comando recebido: ${escapeHtml(trimmed)}`,
    "- Use /help para ver os comandos disponíveis.",
  ]));
};
const pollTelegram = async () => {
  if (!started) {
    pollingTimeout = null;
    return;
  }

  if (pollRequestInFlight) {
    return;
  }

  if (telegramConflictUntil > Date.now()) {
    pollingTimeout = setTimeout(pollTelegram, POLL_RETRY_MS);
    return;
  }

  pollRequestInFlight = true;

  try {
    const url = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getUpdates?offset=${lastUpdateId + 1}&timeout=30`;
    const response = await axios.get(url);
    const updates = response.data.result || [];

    for (const update of updates) {
      lastUpdateId = update.update_id;
      const msg = update.message?.text;
      const chatId = update.message?.chat?.id;
      await handleTelegramCommand(msg, chatId);
    }
  } catch (error) {
    const status = error.response?.status;
    const description = error.response?.data?.description || "";

    if (status === 409 || description.includes("terminated by other getUpdates request")) {
      telegramConflictUntil = Date.now() + 60000;
      logger.warn("Telegram polling em espera: outra instância já está consumindo getUpdates. Nova tentativa em 60 segundos.");
    } else {
      logger.error("%s", formatTelegramError(error));
    }
  } finally {
    pollRequestInFlight = false;
    if (started) {
      pollingTimeout = setTimeout(pollTelegram, POLL_RETRY_MS);
    } else {
      pollingTimeout = null;
    }
  }
};

const startBotListener = () => {
  if (started || pollRequestInFlight) return;

  started = true;
  setupBotCommands();
  scheduleDailyReport();

  memoryWatchInterval = setInterval(() => {
    ensureAlertState();
    const freeMem = os.freemem() / 1024 / 1024 / 1024;
    if (freeMem < 0.3 && alertsActive && !isAlertsMuted()) {
      sendAlert(`Memória crítica: ${freeMem.toFixed(2)} GB livres.`);
    }
  }, 600000);

  pollTelegram();
};

const stopBotListener = () => {
  started = false;
  pollRequestInFlight = false;
  telegramConflictUntil = 0;
  clearBotWork();
};


process.once("SIGINT", () => {
  stopBotListener();
  process.exit(0);
});

process.once("SIGTERM", () => {
  stopBotListener();
  process.exit(0);
});

module.exports = { sendAlert, startBotListener };
