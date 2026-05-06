const { escapeHtml } = require("../utils");

const DEFAULT_THEME = {
  accent: "#6d28d9",
  accentDark: "#4c1d95",
  accentSoft: "#f3e8ff",
  page: "#f5f5f7",
  panel: "#ffffff",
  panelSoft: "#fafafa",
  text: "#18181b",
  muted: "#52525b",
  subtle: "#71717a",
  border: "#e4e4e7",
};

const THEME_PRESETS = {
  verification: DEFAULT_THEME,
  reset: DEFAULT_THEME,
  welcome: DEFAULT_THEME,
  follow: DEFAULT_THEME,
  reply: DEFAULT_THEME,
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
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:28px 0 4px;">
      <tr>
        ${validActions
          .map((action, index) => {
            const isSecondary = action.variant === "secondary";
            const styles = isSecondary
              ? `display:inline-block;padding:12px 18px;border-radius:8px;border:1px solid ${theme.border};background:#ffffff;color:${theme.accentDark};text-decoration:none;font-weight:700;font-size:14px;line-height:1.2;`
              : `display:inline-block;padding:12px 18px;border-radius:8px;background:${theme.accent};color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;line-height:1.2;`;

            return `
              <td style="${index ? "padding-left:10px;" : ""}padding-top:4px;">
                <a href="${escapeHtml(action.href)}" style="${styles}" target="_blank" rel="noreferrer">${escapeHtml(action.label)}</a>
              </td>
            `;
          })
          .join("")}
      </tr>
    </table>
  `;
};

const renderSection = (section, theme) => {
  if (!section) return "";

  if (section.type === "list") {
    const items = (section.items || [])
      .filter(Boolean)
      .map(
        (item) => `
          <tr>
            <td style="width:14px;padding:0 10px 9px 0;color:${theme.accent};font-weight:700;vertical-align:top;">•</td>
            <td style="padding:0 0 9px 0;color:${theme.text};font-size:15px;line-height:1.55;">${escapeHtml(item)}</td>
          </tr>
        `
      )
      .join("");

    if (!items) return "";

    return `
      <div style="margin:22px 0;padding:18px 20px;border-radius:8px;border:1px solid ${theme.border};background:${theme.panelSoft};">
        ${section.title ? `<p style="margin:0 0 12px;font-size:13px;font-weight:700;color:${theme.text};">${escapeHtml(section.title)}</p>` : ""}
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="width:100%;">${items}</table>
      </div>
    `;
  }

  if (section.type === "image") {
    if (!section.src) return "";

    return `
      <div style="margin:22px 0;padding:18px 20px;border-radius:8px;border:1px solid ${theme.border};background:${theme.panelSoft};">
        ${section.title ? `<p style="margin:0 0 12px;font-size:13px;font-weight:700;color:${theme.text};">${escapeHtml(section.title)}</p>` : ""}
        ${section.body ? `<p style="margin:0 0 16px;color:${theme.text};font-size:15px;line-height:1.65;">${escapeHtml(section.body)}</p>` : ""}
        <img src="${escapeHtml(section.src)}" alt="${escapeHtml(section.alt || "")}" style="display:block;width:100%;height:auto;border-radius:8px;" />
      </div>
    `;
  }

  return `
    <div style="margin:22px 0;padding:18px 20px;border-radius:8px;border:1px solid ${theme.border};background:${theme.panelSoft};">
      ${section.title ? `<p style="margin:0 0 10px;font-size:13px;font-weight:700;color:${theme.text};">${escapeHtml(section.title)}</p>` : ""}
      <p style="margin:0;color:${theme.text};font-size:15px;line-height:1.65;white-space:pre-wrap;">${escapeHtml(section.body || "")}</p>
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
  footerNote,
}) => {
  const palette = resolveTheme(theme);
  const safeSections = sections.filter(Boolean).map((section) => renderSection(section, palette)).join("");

  return `
    <div style="margin:0;padding:0;background:${palette.page};font-family:Arial,Helvetica,sans-serif;color:${palette.text};">
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:${palette.page};">
        <tr>
          <td style="padding:32px 14px;">
            <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:640px;margin:0 auto;background:${palette.panel};border:1px solid ${palette.border};border-radius:10px;overflow:hidden;">
              <tr>
                <td style="padding:22px 28px;border-bottom:1px solid ${palette.border};background:#ffffff;">
                  <p style="margin:0;color:${palette.accent};font-size:14px;line-height:1;font-weight:800;">CineSorte</p>
                </td>
              </tr>

              <tr>
                <td style="padding:30px 28px 8px;">
                  <p style="margin:0 0 12px;color:${palette.subtle};font-size:12px;line-height:1.4;font-weight:700;text-transform:uppercase;letter-spacing:.08em;">${escapeHtml(eyebrow)}</p>
                  ${heroLabel ? `<p style="margin:0 0 8px;color:${palette.accentDark};font-size:13px;line-height:1.5;font-weight:700;">${escapeHtml(heroLabel)}</p>` : ""}
                  <h1 style="margin:0;color:${palette.text};font-size:26px;line-height:1.25;font-weight:800;">${escapeHtml(title)}</h1>
                  <p style="margin:16px 0 0;color:${palette.muted};font-size:16px;line-height:1.65;">${escapeHtml(intro)}</p>
                  ${renderActions(actions, palette)}
                </td>
              </tr>

              <tr>
                <td style="padding:0 28px 30px;">
                  ${safeSections}
                  ${outro ? `<p style="margin:24px 0 0;color:${palette.muted};font-size:15px;line-height:1.65;">${escapeHtml(outro)}</p>` : ""}
                </td>
              </tr>

              <tr>
                <td style="padding:20px 28px;background:${palette.panelSoft};border-top:1px solid ${palette.border};">
                  <p style="margin:0;color:${palette.text};font-size:14px;font-weight:700;">Equipe CineSorte</p>
                  ${
                    footerNote
                      ? `<p style="margin:8px 0 0;color:${palette.subtle};font-size:12px;line-height:1.6;">${escapeHtml(footerNote)}</p>`
                      : ""
                  }
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </div>
  `;
};

module.exports = {
  buildEmailLayout,
};
