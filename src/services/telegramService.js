const axios = require("axios");
const env = require("../config/env");
const os = require("os");
const logger = require("../utils/logger");
const { db } = require("../config/firebase");

let alertsActive = true;
let lastUpdateId = 0;
let pollingTimeout = null;

const sendAlert = async (message) => {
  if (!alertsActive) return;
  try {
    const url = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`;
    await axios.post(url, {
      chat_id: env.TELEGRAM_CHAT_ID,
      text: `🚨 *SISTEMA CINESORTE*\n\n${message}`,
      parse_mode: "Markdown",
    });
  } catch (error) {
    logger.error(error.response?.data || error.message);
  }
};

const setupBotCommands = async () => {
  try {
    const url = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/setMyCommands`;
    await axios.post(url, {
      commands: [
        { command: "status", description: "Resumo de performance e RAM" },
        { command: "health", description: "Saude do processo Node.js" },
        { command: "top", description: "Usuarios mais ativos no minuto" },
        { command: "info", description: "O que esta sendo vigiado" },
        { command: "stop", description: "Silenciar notificacoes" },
        { command: "start", description: "Reativar alertas" },
        { command: "help", description: "Lista de comandos" },
      ],
    });
  } catch (error) {
    logger.error(error.response?.data || error.message);
  }
};

const getHelpMessage = () => {
  return (
    `🤖 *PAINEL DE CONTROLE*\n\n` +
    `📊 /status - Resumo de performance e RAM\n` +
    `🩺 /health - Saude do processo Node.js\n` +
    `🔥 /top - Usuarios mais ativos no minuto\n` +
    `🔍 /info - O que esta sendo vigiado\n` +
    `🔕 /stop - Silenciar notificacoes\n` +
    `✅ /start - Reativar alertas\n` +
    `❓ /help - Ver esta lista`
  );
};

const sendDailyReport = async () => {
  const freeMem = (os.freemem() / 1024 / 1024 / 1024).toFixed(2);
  const uptime = Math.floor(process.uptime() / 3600);

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);

  let newUsers = 0;
  let newReviews = 0;
  let totalUsers = 0;
  let totalReviews = 0;

  try {
    const usersRef = db.collection("users");
    const reviewsRef = db.collection("reviews");

    const newUsersSnapshot = await usersRef.where("createdAt", ">=", yesterday).get();
    newUsers = newUsersSnapshot.size;

    const newReviewsSnapshot = await reviewsRef.where("createdAt", ">=", yesterday).get();
    newReviews = newReviewsSnapshot.size;

    const totalUsersSnapshot = await usersRef.count().get();
    totalUsers = totalUsersSnapshot.data().count;

    const totalReviewsSnapshot = await reviewsRef.count().get();
    totalReviews = totalReviewsSnapshot.data().count;
  } catch (error) {
    logger.error(error.message);
  }

  const report =
    `📅 *RELATORIO DIARIO*\n\n` +
    `*Servidor:*\n` +
    `- Uptime: ${uptime} horas\n` +
    `- RAM Livre: ${freeMem} GB\n\n` +
    `*Banco de Dados (Crescimento 24h):*\n` +
    `- Novos Cadastros: ${newUsers}\n` +
    `- Novas Reviews: ${newReviews}\n\n` +
    `*Total Acumulado no Firebase:*\n` +
    `- Total de Usuarios: ${totalUsers}\n` +
    `- Total de Reviews: ${totalReviews}`;

  const originalAlerts = alertsActive;
  alertsActive = true;
  await sendAlert(report);
  alertsActive = originalAlerts;
};

const scheduleDailyReport = () => {
  setInterval(() => {
    const now = new Date();
    const baTime = new Date(
      now.toLocaleString("en-US", { timeZone: "America/Bahia" })
    );
    if (baTime.getHours() === 8 && baTime.getMinutes() === 0) {
      sendDailyReport();
    }
  }, 60000);
};

const pollTelegram = async () => {
  const { userTracker } = require("../middleware/security");

  try {
    const url = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getUpdates?offset=${lastUpdateId + 1}&timeout=30`;
    const response = await axios.get(url);
    const updates = response.data.result;

    for (const update of updates) {
      lastUpdateId = update.update_id;
      const msg = update.message?.text;
      const chatId = update.message?.chat?.id?.toString();

      if (chatId === env.TELEGRAM_CHAT_ID && msg) {
        if (msg === "/start") {
          alertsActive = true;
          await sendAlert("✅ *ALERTAS REATIVADOS*\n\n" + getHelpMessage());
        } else if (msg === "/stop") {
          await sendAlert("🔕 *ALERTAS SILENCIADOS*");
          alertsActive = false;
        } else if (msg === "/help") {
          await sendAlert(getHelpMessage());
        } else if (msg === "/status") {
          const uptime = Math.floor(process.uptime() / 60);
          const load = os.loadavg();
          const freeMem = (os.freemem() / 1024 / 1024 / 1024).toFixed(2);
          await sendAlert(
            `📊 *ESTATISTICAS:*\n\n*Uptime:* ${uptime} min\n*CPU Load:* ${load[0].toFixed(2)}\n*RAM Livre:* ${freeMem} GB`
          );
        } else if (msg === "/top") {
          const topUsers = [...userTracker.entries()]
            .sort((a, b) => b[1].count - a[1].count)
            .slice(0, 5)
            .map(([user, data]) => `@${user}: ${data.count} req/min`)
            .join("\n");
          await sendAlert(`🔥 *RANKING:*\n\n${topUsers || "Ninguem ativo."}`);
        } else if (msg === "/health") {
          const used = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2);
          await sendAlert(
            `🩺 *DADOS TECNICOS:*\n\n*Heap Memory:* ${used} MB\n*Node:* ${process.version}\n*Plataforma:* ${process.platform}`
          );
        } else if (msg === "/info") {
          await sendAlert(
            `🔍 *VIGILANCIA:*\n\n1. Erros 500\n2. Brute Force\n3. Postman\n4. Scraping\n5. CORS`
          );
        }
      }
    }
  } catch (error) {
    logger.error(error.response?.data || error.message);
  } finally {
    pollingTimeout = setTimeout(pollTelegram, 2000);
  }
};

const startBotListener = () => {
  setupBotCommands();
  scheduleDailyReport();

  setInterval(() => {
    const freeMem = os.freemem() / 1024 / 1024 / 1024;
    if (freeMem < 0.3 && alertsActive) {
      sendAlert(`⚠️ *MEMORIA CRITICA:* ${freeMem.toFixed(2)} GB livre.`);
    }
  }, 600000);

  pollTelegram();
};

module.exports = { sendAlert, startBotListener };