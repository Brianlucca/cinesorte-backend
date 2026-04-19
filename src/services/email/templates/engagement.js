const env = require("../../../config/env");
const { buildEmailLayout } = require("./layout");

const appUrl = env.FRONTEND_URL.replace(/\/$/, "");
const profileUrl = `${appUrl}/app/profile`;
const settingsUrl = `${appUrl}/app/settings`;
const homeUrl = `${appUrl}/`;

const buildMediaUrl = (mediaType, mediaId) => {
  const rawId = String(mediaId || "");
  if (!mediaType || !rawId) return settingsUrl;

  if (mediaType === "person") {
    return `${appUrl}/app/person/${rawId}`;
  }

  if (mediaType === "episode" || (rawId.includes("-s") && rawId.includes("-e"))) {
    const match = rawId.match(/^tv-(\d+)-s(\d+)-e(\d+)$/i);
    if (match) {
      const [, tvId, season, episode] = match;
      return `${appUrl}/app/tv/${tvId}/season/${Number(season)}/episode/${Number(episode)}`;
    }
  }

  if (mediaType === "tv") {
    return `${appUrl}/app/tv/${rawId.replace(/^tv-/, "")}`;
  }

  return `${appUrl}/app/${mediaType}/${rawId.replace(/^(movie-|tv-)/, "")}`;
};

const buildFollowNotificationEmail = ({
  userEmail,
  userName,
  followerName,
  followerUsername,
}) => {
  const displayName = userName || "cinéfilo";
  const followerDisplay = followerName || followerUsername || "Alguém";
  const followerHandle = followerUsername ? `@${followerUsername}` : null;

  const text = [
    `Olá, ${displayName}.`,
    "",
    `${followerDisplay}${followerHandle ? ` (${followerHandle})` : ""} começou a seguir você no CineSorte.`,
    "Entre no seu perfil para continuar a conversa e acompanhar sua comunidade.",
    "",
    profileUrl,
    "",
    "Equipe CineSorte",
  ].join("\n");

  const html = buildEmailLayout({
    title: "Você ganhou um novo seguidor",
    intro: `${followerDisplay}${followerHandle ? ` (${followerHandle})` : ""} começou a seguir você no CineSorte.`,
    eyebrow: "Novo seguidor",
    heroLabel: "Comunidade em movimento",
    heroImage: `${appUrl}/preview2.png`,
    theme: "follow",
    actions: [{ label: "Ver perfil de quem seguiu", href: followerUsername ? `${appUrl}/app/profile/${followerUsername}` : profileUrl }],
    sections: [
      {
        type: "list",
        title: "O que você pode fazer agora",
        items: [
          "Conferir quem começou a te seguir",
          "Visitar o perfil e descobrir os gostos da pessoa",
          "Acompanhar sua comunidade de perto",
        ],
      },
    ],
    footerNote: "Este email é automático e foi enviado porque alguém interagiu com o seu perfil.",
  });

  return {
    to: userEmail,
    subject: "Você ganhou um novo seguidor no CineSorte",
    text,
    html,
    logLabel: "follow_notification_email",
  };
};

const buildReviewCommentEmail = ({
  userEmail,
  userName,
  senderName,
  senderUsername,
  mediaTitle,
  mediaType,
  mediaId,
  reviewText,
}) => {
  const displayName = userName || "cinéfilo";
  const senderDisplay = senderName || senderUsername || "Alguém";
  const reviewPreview = reviewText ? `${String(reviewText).slice(0, 180)}${String(reviewText).length > 180 ? "..." : ""}` : null;

  const text = [
    `Olá, ${displayName}.`,
    "",
    `${senderDisplay}${senderUsername ? ` (@${senderUsername})` : ""} comentou na sua review${mediaTitle ? ` de ${mediaTitle}` : ""}.`,
    "",
    reviewPreview ? `Sua review: ${reviewPreview}` : "Abra o CineSorte para ver a nova interação em detalhes.",
    "",
    settingsUrl,
    "",
    "Equipe CineSorte",
  ].join("\n");

  const html = buildEmailLayout({
    title: "Nova resposta em uma review sua",
    intro: `${senderDisplay}${senderUsername ? ` (@${senderUsername})` : ""} comentou em uma review sua no CineSorte.`,
    eyebrow: "Nova interação",
    heroLabel: mediaTitle || "Discussão em andamento",
    theme: "reply",
    heroImage: `${appUrl}/preview.png`,
    actions: [{ label: "Ir até a review", href: buildMediaUrl(mediaType, mediaId) }],
    sections: [
      mediaTitle
        ? {
            type: "list",
            title: "Contexto",
            items: [`Obra: ${mediaTitle}`],
          }
        : null,
      reviewPreview
        ? {
            title: "Sua review",
            body: reviewPreview,
          }
        : {
            title: "Próximo passo",
            body: "Entre no CineSorte para ver a nova interação em detalhes.",
          },
    ],
    footerNote: "Este email é automático e foi enviado porque houve uma nova interação em uma review sua.",
  });

  return {
    to: userEmail,
    subject: "Nova resposta em uma review sua no CineSorte",
    text,
    html,
    logLabel: "review_comment_email",
  };
};

const buildCommentReplyEmail = ({
  userEmail,
  userName,
  senderName,
  senderUsername,
  mediaTitle,
  mediaType,
  mediaId,
  originalCommentText,
}) => {
  const displayName = userName || "cinéfilo";
  const senderDisplay = senderName || senderUsername || "Alguém";
  const commentPreview = originalCommentText
    ? `${String(originalCommentText).slice(0, 180)}${String(originalCommentText).length > 180 ? "..." : ""}`
    : null;

  const text = [
    `Olá, ${displayName}.`,
    "",
    `${senderDisplay}${senderUsername ? ` (@${senderUsername})` : ""} respondeu um comentário seu${mediaTitle ? ` em ${mediaTitle}` : ""}.`,
    "",
    commentPreview ? `Seu comentário: ${commentPreview}` : "Abra o CineSorte para acompanhar a conversa.",
    "",
    settingsUrl,
    "",
    "Equipe CineSorte",
  ].join("\n");

  const html = buildEmailLayout({
    title: "Responderam um comentário seu",
    intro: `${senderDisplay}${senderUsername ? ` (@${senderUsername})` : ""} respondeu um comentário seu no CineSorte.`,
    eyebrow: "Nova resposta",
    heroLabel: mediaTitle || "Conversa em andamento",
    theme: "reply",
    heroImage: `${appUrl}/preview2.png`,
    actions: [{ label: "Ir até a review", href: buildMediaUrl(mediaType, mediaId) }],
    sections: [
      mediaTitle
        ? {
            type: "list",
            title: "Contexto",
            items: [`Obra: ${mediaTitle}`],
          }
        : null,
      commentPreview
        ? {
            title: "Seu comentário",
            body: commentPreview,
          }
        : {
            title: "Próximo passo",
            body: "Entre no CineSorte para acompanhar a conversa.",
          },
    ],
    footerNote: "Este email é automático e foi enviado porque alguém respondeu um comentário seu.",
  });

  return {
    to: userEmail,
    subject: "Responderam um comentário seu no CineSorte",
    text,
    html,
    logLabel: "comment_reply_email",
  };
};

const buildAccountDeletionEmail = ({ userEmail, userName }) => {
  const displayName = userName || "cinéfilo";

  const text = [
    `Olá, ${displayName}.`,
    "",
    "Sua conta no CineSorte foi excluída com sucesso.",
    "Se isso não foi feito por você, entre em contato com a equipe o quanto antes.",
    "",
    settingsUrl,
    "",
    "Equipe CineSorte",
  ].join("\n");

  const html = buildEmailLayout({
    title: "Sua conta foi excluída",
    intro: "Confirmamos a exclusão da sua conta no CineSorte.",
    eyebrow: "Conta encerrada",
    heroLabel: "Registro de segurança",
    theme: "reset",
    actions: [{ label: "Ir para a página inicial", href: homeUrl, variant: "secondary" }],
    sections: [
      {
        type: "list",
        title: "Importante",
        items: [
          "A conta e os dados associados deixaram de ficar disponíveis para uso normal",
          "Se esta ação não foi feita por você, entre em contato com a equipe",
        ],
      },
    ],
    footerNote: "Este email foi enviado automaticamente para registrar uma ação importante da conta.",
  });

  return {
    to: userEmail,
    subject: "Sua conta no CineSorte foi excluída",
    text,
    html,
    logLabel: "account_deletion_email",
  };
};

module.exports = {
  buildAccountDeletionEmail,
  buildCommentReplyEmail,
  buildFollowNotificationEmail,
  buildReviewCommentEmail,
};
