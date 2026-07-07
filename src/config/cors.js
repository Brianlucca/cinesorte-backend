const env = require("./env");

const normalizeOrigin = (origin) => String(origin || "").replace(/\/$/, "");

const corsOptions = {
  origin(origin, callback) {
    if (!origin) return callback(null, true);

    const allowedOrigin = normalizeOrigin(env.FRONTEND_URL);
    const requestOrigin = normalizeOrigin(origin);

    if (requestOrigin === allowedOrigin) {
      return callback(null, true);
    }

    return callback(new Error("Not allowed by CORS"));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "Cookie"],
};

module.exports = corsOptions;
