const env = require("./env");

const normalizeOrigin = (origin) => String(origin || "").replace(/\/$/, "");
const EXTENSION_ORIGIN_PATTERN = /^chrome-extension:\/\/[a-p]{32}$/;

const isExtensionApiRequest = (req) => {
  const path = req.originalUrl.split("?")[0];
  const method = req.method === "OPTIONS" ? req.headers["access-control-request-method"] : req.method;
  if (path === "/api/watch-progress/pairing/exchange" && method === "POST") return true;
  if (path === "/api/watch-progress" && ["PUT", "DELETE"].includes(method)) return true;
  return path.startsWith("/api/watch-progress/token/") && ["GET", "DELETE"].includes(method);
};

const corsOptions = (req, callback) => {
  const requestOrigin = normalizeOrigin(req.headers.origin);
  const frontendOrigin = normalizeOrigin(env.FRONTEND_URL);
  const base = {
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "Cookie"],
  };

  if (!requestOrigin || requestOrigin === frontendOrigin) {
    return callback(null, { ...base, origin: true, credentials: true });
  }

  if (EXTENSION_ORIGIN_PATTERN.test(requestOrigin) && isExtensionApiRequest(req)) {
    return callback(null, { ...base, origin: true, credentials: false, allowedHeaders: ["Content-Type", "Authorization"] });
  }

  return callback(new Error("Not allowed by CORS"));
};

module.exports = corsOptions;
