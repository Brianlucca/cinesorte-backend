const { escapeHtml } = require("../utils");

const DEFAULT_THEME = {
  accent: "#8b5cf6",
  accentSoft: "rgba(139,92,246,0.18)",
  panel: "#16161c",
  panelSoft: "#101016",
  page: "#09090d",
  text: "#fafafa",
  muted: "#c4b5fd",
  border: "rgba(139,92,246,0.18)",
};

const THEME_PRESETS = {
  verification: {
    accent: "#a855f7",
    accentSoft: "rgba(168,85,247,0.18)",
    panel: "#17131f",
    panelSoft: "#100d16",
    page: "#09070d",
    text: "#faf5ff",
    muted: "#ddd6fe",
    border: "rgba(168,85,247,0.18)",
  },
  reset: {
    accent: "#8b5cf6",
    accentSoft: "rgba(139,92,246,0.18)",
    panel: "#15111d",
    panelSoft: "#0f0c15",
    page: "#09070d",
    text: "#fdfcff",
    muted: "#ddd6fe",
    border: "rgba(139,92,246,0.18)",
  },
  welcome: {
    accent: "#8b5cf6",
    accentSoft: "rgba(139,92,246,0.18)",
    panel: "#15111d",
    panelSoft: "#0f0c15",
    page: "#09070d",
    text: "#f5f3ff",
    muted: "#ddd6fe",
    border: "rgba(139,92,246,0.16)",
  },
  follow: {
    accent: "#8b5cf6",
    accentSoft: "rgba(139,92,246,0.18)",
    panel: "#15111d",
    panelSoft: "#0f0c15",
    page: "#09070d",
    text: "#fafafa",
    muted: "#ddd6fe",
    border: "rgba(139,92,246,0.16)",
  },
  reply: {
    accent: "#8b5cf6",
    accentSoft: "rgba(139,92,246,0.18)",
    panel: "#15111d",
    panelSoft: "#0f0c15",
    page: "#09070d",
    text: "#fafafa",
    muted: "#ddd6fe",
    border: "rgba(139,92,246,0.16)",
  },
  notice: DEFAULT_THEME,
};

const resolveTheme = (theme) => {
  if (!theme) return DEFAULT_THEME;
  if (typeof theme === "string") return THEME_PRESETS[theme] || DEFAULT_THEME;
  return { ...DEFAULT_THEME, ...theme };
};

const renderActions = (actions = [], theme) => {
  const validActions = actions.filter((action) => action?.label && action?.href);
  if (!validActions.length) return "";

  return `
    <div style="margin:28px 0 6px;">
      ${validActions
        .map((action, index) => {
          const variant = action.variant === "secondary" ? "secondary" : "primary";
          const buttonStyles =
            variant === "secondary"
              ? `display:inline-block;margin:${index ? "10px 0 0 12px" : "10px 0 0 0"};padding:13px 18px;border-radius:16px;border:1px solid ${theme.border};background:rgba(255,255,255,0.04);color:${theme.text};text-decoration:none;font-weight:700;font-size:14px;`
              : `display:inline-block;margin:${index ? "10px 0 0 12px" : "10px 0 0 0"};padding:13px 18px;border-radius:16px;background:${theme.accent};color:#ffffff;text-decoration:none;font-weight:800;font-size:14px;box-shadow:0 10px 30px ${theme.accentSoft};`;

          return `<a href="${escapeHtml(action.href)}" style="${buttonStyles}" target="_blank" rel="noreferrer">${escapeHtml(
            action.label
          )}</a>`;
        })
        .join("")}
    </div>
  `;
};

const renderSection = (section, theme) => {
  if (!section) return "";

  if (section.type === "list") {
    const items = (section.items || [])
      .filter(Boolean)
      .map(
        (item) =>
          `<li style="margin:0 0 10px 0;color:${theme.text};"><span style="color:${theme.accent};font-weight:800;">•</span> ${escapeHtml(
            item
          )}</li>`
      )
      .join("");

    return `
      <div style="margin:18px 0;padding:20px 22px;border-radius:24px;border:1px solid ${theme.border};background:${theme.panelSoft};">
        ${section.title ? `<p style="margin:0 0 12px;font-size:12px;font-weight:800;letter-spacing:.18em;text-transform:uppercase;color:${theme.muted};">${escapeHtml(section.title)}</p>` : ""}
        <ul style="margin:0;padding-left:0;list-style:none;">${items}</ul>
      </div>
    `;
  }

  return `
    <div style="margin:18px 0;padding:20px 22px;border-radius:24px;border:1px solid ${theme.border};background:${theme.panelSoft};">
      ${section.title ? `<p style="margin:0 0 12px;font-size:12px;font-weight:800;letter-spacing:.18em;text-transform:uppercase;color:${theme.muted};">${escapeHtml(section.title)}</p>` : ""}
      <p style="margin:0;color:${theme.text};white-space:pre-wrap;">${escapeHtml(section.body || "")}</p>
    </div>
  `;
};

const buildEmailLayout = ({
  title,
  intro,
  sections = [],
  outro,
  actions = [],
  eyebrow = "CineSorte",
  theme = "notice",
  heroLabel,
  heroImage,
  footerNote,
}) => {
  const palette = resolveTheme(theme);
  const safeSections = sections.filter(Boolean).map((section) => renderSection(section, palette)).join("");
  const safeHeroImage = heroImage
    ? `<img src="${escapeHtml(heroImage)}" alt="" style="width:100%;max-width:240px;height:auto;border-radius:20px;border:1px solid ${palette.border};display:block;box-shadow:0 18px 50px rgba(0,0,0,0.35);" />`
    : "";

  return `
    <div style="margin:0;padding:0;background:${palette.page};font-family:Arial,Helvetica,sans-serif;">
      <div style="max-width:760px;margin:0 auto;padding:28px 18px 40px;">
        <div style="padding:28px;border-radius:32px;background:linear-gradient(145deg, ${palette.panel} 0%, ${palette.panelSoft} 100%);border:1px solid ${palette.border};overflow:hidden;">
          <div style="position:relative;padding:0 0 24px 0;border-bottom:1px solid ${palette.border};">
            <div style="display:inline-block;padding:8px 12px;border-radius:999px;background:${palette.accentSoft};color:${palette.accent};font-size:11px;font-weight:900;letter-spacing:.18em;text-transform:uppercase;">
              ${escapeHtml(eyebrow)}
            </div>
            ${
              heroLabel
                ? `<p style="margin:18px 0 0;color:${palette.muted};font-size:13px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;">${escapeHtml(
                    heroLabel
                  )}</p>`
                : ""
            }
            <div style="margin-top:18px;display:flex;gap:24px;align-items:flex-start;flex-wrap:wrap;">
              <div style="flex:1 1 320px;min-width:280px;">
                <h1 style="margin:0 0 14px;color:${palette.text};font-size:34px;line-height:1.08;">${escapeHtml(title)}</h1>
                <p style="margin:0;color:${palette.muted};font-size:16px;line-height:1.7;">${escapeHtml(intro)}</p>
                ${renderActions(actions, palette)}
              </div>
              ${
                safeHeroImage
                  ? `<div style="flex:0 0 240px;max-width:240px;margin-left:auto;">${safeHeroImage}</div>`
                  : ""
              }
            </div>
          </div>

          <div style="padding-top:26px;">
            ${safeSections}
            ${outro ? `<p style="margin:28px 0 0;color:${palette.muted};font-size:15px;line-height:1.7;">${escapeHtml(outro)}</p>` : ""}
            <div style="margin-top:30px;padding-top:20px;border-top:1px solid ${palette.border};">
              <p style="margin:0;color:${palette.text};font-weight:800;">Equipe CineSorte</p>
              ${
                footerNote
                  ? `<p style="margin:10px 0 0;color:${palette.muted};font-size:13px;line-height:1.6;">${escapeHtml(footerNote)}</p>`
                  : ""
              }
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
};

module.exports = {
  buildEmailLayout,
};
