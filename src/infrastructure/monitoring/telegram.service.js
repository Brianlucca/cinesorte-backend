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
    "/help - exibe esta ajuda",
  ]);

const setupBotCommands = async () => {
  try {
    const url = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/setMyCommands`;
    await axios.post(url, {
      commands: [
        { command: "today", description: "Atividade das últimas 24h" },
        { command: "report", description: "Relatório sob demanda" },
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

  const [newUsers, newReviews, newComments, newListShares] = await Promise.all([
    getCollectionCount("users", [{ field: "createdAt", operator: ">=", value: since }]),
    getCollectionCount("reviews", [{ field: "createdAt", operator: ">=", value: since }]),
    getCollectionCount("comments", [{ field: "createdAt", operator: ">=", value: since }]),
    getCollectionCount("shared_lists", [{ field: "createdAt", operator: ">=", value: since }]),
  ]);

  return { newUsers, newReviews, newComments, newListShares };
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
