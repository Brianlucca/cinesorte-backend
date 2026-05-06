const env = require("../../../config/env");
const { buildEmailLayout } = require("./layout");

const appUrl = env.FRONTEND_URL.replace(/\/$/, "");
const loginUrl = `${appUrl}/login`;
const profileUrl = `${appUrl}/app/profile`;
const settingsUrl = `${appUrl}/app/settings`;

const buildWelcomeEmail = ({ userEmail, userName, username }) => {
  const displayName = userName || "cinéfilo";
  const text = [
    `Olá, ${displayName}.`,
    "",
    "Seu email foi confirmado e sua conta no CineSorte está pronta para uso.",
    username ? `Username: @${username}.` : null,
    "",
    loginUrl,
    "",
    "Equipe CineSorte",
  ]
    .filter(Boolean)
    .join("\n");

  const html = buildEmailLayout({
    title: "Conta confirmada",
    intro: `Olá, ${displayName}. Seu email foi confirmado e sua conta no CineSorte está pronta para uso.`,
    eyebrow: "Conta",
    theme: "welcome",
    actions: [{ label: "Entrar no CineSorte", href: loginUrl }],
    sections: username
      ? [
          {
            type: "list",
            title: "Dados da conta",
            items: [`Username: @${username}`],
          },
        ]
      : [],
    footerNote: "Este email confirma uma ação realizada na sua conta.",
  });

  return {
    to: userEmail,
    subject: "Sua conta no CineSorte foi confirmada",
    text,
    html,
    logLabel: "welcome_email",
  };
};

const buildAccountNoticeEmail = ({ userEmail, userName, subject, title, intro, lines = [], outro, actions = [] }) => {
  const displayName = userName || "cinéfilo";
  const text = [
    `Olá, ${displayName}.`,
    "",
    intro,
    "",
    ...lines,
    ...(outro ? ["", outro] : []),
    ...(actions?.[0]?.href ? ["", actions[0].href] : []),
    "",
    "Equipe CineSorte",
  ]
    .filter(Boolean)
    .join("\n");

  const html = buildEmailLayout({
    title,
    intro: `Olá, ${displayName}. ${intro}`,
    theme: "notice",
    eyebrow: "Conta",
    actions,
    sections: lines.length ? [{ type: "list", title: "Detalhes", items: lines }] : [],
    outro,
    footerNote: "Este email registra uma atualização importante da sua conta.",
  });

  return {
    to: userEmail,
    subject,
    text,
    html,
    logLabel: "account_notice_email",
  };
};

const buildVerificationEmail = ({ userEmail, userName, username, verificationLink }) => {
  const displayName = userName || "cinéfilo";
  const text = [
    `Olá, ${displayName}.`,
    "",
    "Para concluir seu cadastro no CineSorte, confirme seu email pelo link abaixo:",
    verificationLink,
    "",
    username ? `Username: @${username}` : null,
    "Se você não criou essa conta, ignore este email.",
    "",
    "Equipe CineSorte",
  ]
    .filter(Boolean)
    .join("\n");

  const html = buildEmailLayout({
    title: "Confirme seu email",
    intro: `Olá, ${displayName}. Para concluir seu cadastro no CineSorte, confirme seu email no botão abaixo.`,
    eyebrow: "Verificação de email",
    theme: "verification",
    actions: [{ label: "Confirmar email", href: verificationLink }],
    sections: username
      ? [
          {
            type: "list",
            title: "Cadastro",
            items: [`Username: @${username}`],
          },
        ]
      : [],
    outro: "Se você não criou essa conta, nenhuma ação é necessária.",
    footerNote: "O link é individual e expira conforme as regras de segurança do Firebase.",
  });

  return {
    to: userEmail,
    subject: "Confirme seu email no CineSorte",
    text,
    html,
    logLabel: "verification_email",
  };
};

const buildPasswordResetEmail = ({ userEmail, userName, resetLink }) => {
  const displayName = userName || "cinéfilo";
  const text = [
    `Olá, ${displayName}.`,
    "",
    "Recebemos uma solicitação para redefinir a senha da sua conta.",
    "Use o link abaixo para criar uma nova senha:",
    resetLink,
    "",
    "Se você não solicitou essa alteração, ignore este email.",
    "",
    "Equipe CineSorte",
  ].join("\n");

  const html = buildEmailLayout({
    title: "Redefinição de senha",
    intro: `Olá, ${displayName}. Recebemos uma solicitação para redefinir a senha da sua conta no CineSorte.`,
    eyebrow: "Segurança",
    theme: "reset",
    actions: [{ label: "Criar nova senha", href: resetLink }],
    outro: "Se você não solicitou essa alteração, ignore este email.",
    footerNote: "Este email foi enviado após uma solicitação de recuperação de acesso.",
  });

  return {
    to: userEmail,
    subject: "Redefinição de senha no CineSorte",
    text,
    html,
    logLabel: "password_reset_email",
  };
};

const buildLoginAlertEmail = ({ userEmail, userName, resetLink, accessDate, ip, userAgent, location }) => {
  const displayName = userName || "cinéfilo";
  const locationLabel = location
    ? [location.city, location.region, location.countryName].filter(Boolean).join(", ")
    : null;
  const details = [
    accessDate ? `Data e hora: ${accessDate}` : null,
    ip ? `IP aproximado: ${ip}` : null,
    locationLabel ? `Localização aproximada: ${locationLabel}` : null,
    userAgent ? `Dispositivo/navegador: ${String(userAgent).slice(0, 180)}` : null,
  ].filter(Boolean);
  const mapUrl = location
    ? `https://staticmap.openstreetmap.de/staticmap.php?center=${encodeURIComponent(
        location.latitude
      )},${encodeURIComponent(location.longitude)}&zoom=5&size=600x300&markers=${encodeURIComponent(
        location.latitude
      )},${encodeURIComponent(location.longitude)},red-pushpin`
    : null;

  const text = [
    `Olá, ${displayName}.`,
    "",
    "Detectamos um acesso recente à sua conta CineSorte.",
    "Se foi você, nenhuma ação é necessária.",
    "Se você não reconhece esse acesso, altere sua senha pelo link abaixo:",
    resetLink,
    "",
    ...details,
    "",
    "Equipe CineSorte",
  ].join("\n");

  const sections = [];
  if (details.length) {
    sections.push({
      type: "list",
      title: "Detalhes do acesso",
      items: details,
    });
  }

  if (mapUrl && locationLabel) {
    sections.push({
      type: "image",
      title: "Localização aproximada",
      body: locationLabel,
      src: mapUrl,
      alt: "Mapa aproximado do local de acesso",
    });
  }

  const html = buildEmailLayout({
    title: "Novo acesso à sua conta",
    intro: `Olá, ${displayName}. Detectamos um acesso recente à sua conta CineSorte. Se foi você, nenhuma ação é necessária.`,
    eyebrow: "Segurança",
    theme: "notice",
    actions: [{ label: "Alterar senha", href: resetLink }],
    sections,
    outro: "Se você não reconhece esse acesso, recomendamos alterar sua senha agora.",
    footerNote: "Este email foi enviado para ajudar a proteger sua conta.",
  });

  return {
    to: userEmail,
    subject: "Novo acesso à sua conta CineSorte",
    text,
    html,
    logLabel: "login_alert_email",
    disableQueue: true,
  };
};

const buildAccountDeletionRequestEmail = ({ userEmail, userName, confirmLink, expiresInMinutes = 30 }) => {
  const displayName = userName || "cinéfilo";
  const text = [
    `Olá, ${displayName}.`,
    "",
    "Recebemos uma solicitação para excluir sua conta no CineSorte.",
    `Para confirmar a exclusão, use o link abaixo em até ${expiresInMinutes} minutos:`,
    confirmLink,
    "",
    "Se você não solicitou isso, ignore este email e sua conta continuará ativa.",
    "",
    "Equipe CineSorte",
  ].join("\n");

  const html = buildEmailLayout({
    title: "Confirme a exclusão da conta",
    intro: `Olá, ${displayName}. Recebemos uma solicitação para excluir sua conta no CineSorte.`,
    eyebrow: "Exclusão de conta",
    theme: "reset",
    actions: [{ label: "Confirmar exclusão", href: confirmLink }],
    sections: [
      {
        type: "list",
        title: "Antes de continuar",
        items: [
          "A exclusão é permanente e remove seus dados, listas e reviews",
          `Este link expira em ${expiresInMinutes} minutos`,
          "Se você não solicitou isso, ignore este email",
        ],
      },
    ],
    outro: "Por segurança, a conta só será excluída depois que o botão acima for usado.",
    footerNote: "Este email confirma uma solicitação sensível da conta.",
  });

  return {
    to: userEmail,
    subject: "Confirme a exclusão da sua conta CineSorte",
    text,
    html,
    logLabel: "account_deletion_request_email",
  };
};

module.exports = {
  buildAccountNoticeEmail,
  buildAccountDeletionRequestEmail,
  buildLoginAlertEmail,
  buildPasswordResetEmail,
  buildVerificationEmail,
  buildWelcomeEmail,
};
