const env = require("../../../config/env");
const { buildEmailLayout } = require("./layout");

const appUrl = env.FRONTEND_URL.replace(/\/$/, "");
const loginUrl = `${appUrl}/login`;
const profileUrl = `${appUrl}/app/profile`;

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

module.exports = {
  buildAccountNoticeEmail,
  buildPasswordResetEmail,
  buildVerificationEmail,
  buildWelcomeEmail,
};
