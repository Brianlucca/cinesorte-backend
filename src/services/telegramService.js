const axios = require('axios');
const env = require('../config/env');
const os = require('os');

let alertsActive = true;

const sendAlert = async (message) => {
  if (!alertsActive) return;
  try {
    const url = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`;
    await axios.post(url, {
      chat_id: env.TELEGRAM_CHAT_ID,
      text: `🚨 *SISTEMA CINESORTE* 🚨\n\n${message}`,
      parse_mode: 'Markdown',
    });
  } catch (error) {
    require('../utils/logger').error('Telegram send failed: %o', error);
  }
};

const getHelpMessage = () => {
  return `🤖 *PAINEL DE CONTROLE*\n\n` +
         `📊 /status - Resumo de performance e RAM\n` +
         `🩺 /health - Saúde do processo Node.js\n` +
         `🔥 /top - Usuários mais ativos no minuto\n` +
         `🔍 /info - O que está sendo vigiado\n` +
         `🔕 /stop - Silenciar notificações\n` +
         `✅ /start - Reativar alertas e ver comandos\n` +
         `❓ /help - Ver esta lista novamente`;
};

const startBotListener = () => {
  const { userTracker } = require('../middleware/security');
  let lastUpdateId = 0;

  setInterval(() => {
    const freeMem = os.freemem() / 1024 / 1024 / 1024;
    if (freeMem < 0.3 && alertsActive) {
      sendAlert(`⚠️ *MEMÓRIA CRÍTICA:* Apenas ${freeMem.toFixed(2)} GB de RAM livre.`);
    }
  }, 600000);

  setInterval(async () => {
    try {
      const url = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getUpdates?offset=${lastUpdateId + 1}`;
      const response = await axios.get(url);
      const updates = response.data.result;

      for (const update of updates) {
        lastUpdateId = update.update_id;
        const msg = update.message?.text;
        const chatId = update.message?.chat.id.toString();

        if (chatId === env.TELEGRAM_CHAT_ID) {
          if (msg === '/start') {
            alertsActive = true;
            await sendAlert("✅ *ALERTAS REATIVADOS*\n\n" + getHelpMessage());
          }
          if (msg === '/stop') {
            await sendAlert("🔕 *ALERTAS SILENCIADOS* (Servidor continua ON)");
            alertsActive = false;
          }
          if (msg === '/help') {
            await sendAlert(getHelpMessage());
          }
          if (msg === '/status') {
            const uptime = Math.floor(process.uptime() / 60);
            const load = os.loadavg();
            await sendAlert(`📊 *ESTATÍSTICAS:*\n\n*Uptime:* ${uptime} min\n*CPU Load:* ${load[0].toFixed(2)}\n*RAM Livre:* ${(os.freemem()/1024/1024/1024).toFixed(2)} GB`);
          }
          if (msg === '/top') {
            const topUsers = [...userTracker.entries()]
              .sort((a, b) => b[1].count - a[1].count)
              .slice(0, 5)
              .map(([user, data]) => `@${user}: ${data.count} req/min`)
              .join('\n');
            await sendAlert(`🔥 *RANKING DE ATIVIDADE:*\n\n${topUsers || 'Ninguém ativo no momento.'}`);
          }
          if (msg === '/health') {
            const used = process.memoryUsage().heapUsed / 1024 / 1024;
            await sendAlert(`🩺 *DADOS TÉCNICOS:*\n\n*Heap Memory:* ${used.toFixed(2)} MB\n*Versão Node:* ${process.version}\n*Plataforma:* ${process.platform}`);
          }
          if (msg === '/info') {
            await sendAlert(`🔍 *VIGILÂNCIA ATIVA:*\n\n1. Erros de Banco (500)\n2. Brute Force (Login)\n3. Ferramentas (Postman)\n4. Scraping (Spam de Usuário)\n5. Origens de Segurança (CORS)`);
          }
        }
      }
    } catch (e) {}
  }, 3000);
};

module.exports = { sendAlert, startBotListener };