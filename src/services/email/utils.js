const formatBahiaDateTime = (dateInput) => {
  const date = resolveDate(dateInput) || new Date();

  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Bahia",
    dateStyle: "short",
    timeStyle: "medium",
  }).format(date);
};

const escapeHtml = (value = "") =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");

const resolveDate = (value) => {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value?.toDate === "function") {
    const parsed = value.toDate();
    return Number.isNaN(parsed?.getTime?.()) ? null : parsed;
  }
  if (typeof value === "number") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (typeof value === "object" && typeof value._seconds === "number") {
    const parsed = new Date(value._seconds * 1000 + Math.floor((value._nanoseconds || 0) / 1000000));
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
};

const sortConversation = (conversation = []) =>
  [...conversation].sort((a, b) => {
    const first = resolveDate(a?.createdAt)?.getTime?.() || 0;
    const second = resolveDate(b?.createdAt)?.getTime?.() || 0;
    return first - second;
  });

const normalizeConversation = (conversation = [], fallbackMessage) => {
  const items = Array.isArray(conversation) ? [...conversation] : [];

  if (fallbackMessage) {
    const normalizedFallback = String(fallbackMessage).trim();
    const hasOpeningMessage = items.some(
      (entry) => entry?.role === "user" && String(entry?.message || "").trim() === normalizedFallback
    );

    if (!hasOpeningMessage) {
      items.unshift({
        id: "fallback_user_message",
        role: "user",
        author: "Você",
        message: fallbackMessage,
        createdAt: null,
      });
    }
  }

  return sortConversation(items);
};

const buildConversationList = (conversation = []) =>
  conversation.map((entry) => {
    const label = entry.isResolution ? "Encerramento" : entry.role === "admin" ? "Equipe CineSorte" : "Você";
    const createdAt = resolveDate(entry.createdAt) ? formatBahiaDateTime(entry.createdAt) : "Agora mesmo";
    return `${label} (${createdAt}): ${entry.message || "Sem mensagem."}`;
  });

const buildSupportEmailSubject = (protocol) => `[${protocol}] Atendimento CineSorte`;

module.exports = {
  buildConversationList,
  buildSupportEmailSubject,
  escapeHtml,
  formatBahiaDateTime,
  normalizeConversation,
  resolveDate,
};