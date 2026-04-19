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
    "Seu email foi confirmado e a sua conta no CineSorte está pronta para uso.",
    username ? `Seu username é @${username}.` : null,
    "Agora você já pode montar listas, publicar reviews e evoluir seu perfil na comunidade.",
    "",
    profileUrl,
    "",
    "Equipe CineSorte",
  ]
    .filter(Boolean)
    .join("\n");

  const html = buildEmailLayout({
    title: "Seu universo no CineSorte está liberado",
    intro: `Olá, ${displayName}. Seu email já foi confirmado e a sua jornada cinéfila no CineSorte está oficialmente aberta.`,
    eyebrow: "Conta confirmada",
    heroLabel: "Bem-vindo ao CineSorte",
    heroImage: `${appUrl}/preview.png`,
    theme: "welcome",
    actions: [
      { label: "Entrar no CineSorte", href: loginUrl },
      { label: "Abrir meu perfil", href: profileUrl, variant: "secondary" },
    ],
    sections: [
      {
        type: "list",
        title: "Primeiros passos",
        items: [
          username ? `Seu username é @${username}` : "Defina seu username dentro do app",
          "Monte listas com filmes e séries que combinam com você",
          "Publique reviews e acompanhe a sua evolução na comunidade",
        ],
      },
    ],
    footerNote: "Este email foi enviado automaticamente depois da confirmação do seu email.",
  });

  return {
    to: userEmail,
    subject: "Bem-vindo ao CineSorte",
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
    eyebrow: "Atualização da conta",
    actions,
    sections: lines.length ? [{ type: "list", title: "Detalhes", items: lines }] : [],
    outro,
    footerNote: "Este email foi enviado automaticamente para registrar uma ação da sua conta.",
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
    "Sua conta no CineSorte foi criada com sucesso.",
    username ? `Username: @${username}` : null,
    "Clique no link abaixo para confirmar o seu email:",
    verificationLink,
    "",
    "Se você não criou essa conta, ignore este email.",
    "",
    "Equipe CineSorte",
  ]
    .filter(Boolean)
    .join("\n");

  const html = buildEmailLayout({
    title: "Confirme seu email para entrar no CineSorte",
    intro: `Olá, ${displayName}. Falta apenas confirmar o seu email para liberar a sua conta e começar a usar tudo no CineSorte.`,
    eyebrow: "Verificação de email",
    heroLabel: "Ative sua conta",
    heroImage: `${appUrl}/preview2.png`,
    theme: "verification",
    actions: [{ label: "Confirmar meu email", href: verificationLink }],
    sections: [
      username
        ? {
            type: "list",
            title: "Dados da conta",
            items: [`Username: @${username}`],
          }
        : null,
      {
        type: "list",
        title: "Importante",
        items: [
          "Depois da confirmação, sua conta fica liberada para login",
          "Se você não criou essa conta, pode ignorar este email",
        ],
      },
    ],
    outro: "Se o botão não abrir, você ainda pode usar o link presente na versão em texto deste email.",
    footerNote: "Por segurança, o link de confirmação é individual e vinculado à sua conta.",
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
    "Recebemos uma solicitação para redefinir a senha da sua conta no CineSorte.",
    "Clique no link abaixo para criar uma nova senha:",
    resetLink,
    "",
    "Por segurança, as sessões ativas foram encerradas e será necessário fazer login novamente após a troca de senha.",
    "Se você não solicitou essa alteração, ignore este email.",
    "",
    "Equipe CineSorte",
  ].join("\n");

  const html = buildEmailLayout({
    title: "Redefina sua senha com segurança",
    intro: `Olá, ${displayName}. Recebemos uma solicitação para redefinir a senha da sua conta no CineSorte.`,
    eyebrow: "Redefinição de senha",
    heroLabel: "Acesso seguro",
    heroImage: `${appUrl}/preview.png`,
    theme: "reset",
    actions: [{ label: "Criar nova senha", href: resetLink }],
    sections: [
      {
        type: "list",
        title: "Importante",
        items: [
          "As sessões ativas foram encerradas por segurança",
          "Depois de trocar a senha, será necessário fazer login novamente",
          "Se você não solicitou essa alteração, ignore este email",
        ],
      },
    ],
    outro: "Se o botão não abrir, você ainda pode usar o link presente na versão em texto deste email.",
    footerNote: "Este email foi enviado automaticamente após uma solicitação de redefinição de senha.",
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
