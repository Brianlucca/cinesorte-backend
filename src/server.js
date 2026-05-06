const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const helmet = require("helmet");
const env = require("./config/env");
const errorHandler = require("./middleware/error");
const {
  sanitizeInput,
  shield,
  protectStateChangingRequests,
  userSpamDetector,
  tmdbApiLimiter,
} = require("./middleware/security");
const { startBotListener } = require("./services/telegramService");
const { startSupportInboxListener } = require("./services/supportInboxService");
const { startEmailRetryWorker } = require("./services/email/retryWorker");
const { startVerificationEmailRescueWorker } = require("./services/emailVerificationRescueWorker");

const tmdbRoutes = require("./routes/tmdbRoutes");
const interactionRoutes = require("./routes/interactionRoutes");
const socialRoutes = require("./routes/socialRoutes");
const authRoutes = require("./routes/authRoutes");
const notificationRoutes = require("./routes/notificationRoutes");

const app = express();

const corsOptions = {
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);

    const normalizedAllowedOrigin = env.FRONTEND_URL.endsWith("/")
      ? env.FRONTEND_URL.slice(0, -1)
      : env.FRONTEND_URL;
    const normalizedOrigin = origin
      ? origin.endsWith("/")
        ? origin.slice(0, -1)
        : origin
      : "";

    if (normalizedOrigin === normalizedAllowedOrigin) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "Cookie"],
};

app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
    contentSecurityPolicy: false,
  })
);

app.use(cors(corsOptions));
app.use(express.json({ limit: "10kb" }));
app.use(cookieParser());

app.use(shield);
app.use(protectStateChangingRequests);
app.use(userSpamDetector);
app.use(sanitizeInput);

app.get("/", (req, res) => res.json({ message: "Cinesorte Secure API" }));
app.get("/api/health", (req, res) => res.sendStatus(200));

app.use("/api/tmdb", tmdbApiLimiter, tmdbRoutes);
app.use("/api/users", authRoutes);
app.use("/api/users", interactionRoutes);
app.use("/api/social", socialRoutes);
app.use("/api/notifications", notificationRoutes);

app.use((req, res) => {
  res.status(404).json({
    status: "fail",
    message: `Rota ${req.originalUrl} não encontrada.`,
  });
});

app.use(errorHandler);

if (env.NODE_ENV === "production") {
  app.set("trust proxy", 1);
  app.use((req, res, next) => {
    if (
      req.headers["x-forwarded-proto"] &&
      req.headers["x-forwarded-proto"] !== "https"
    ) {
      return res.redirect(301, `https://${req.headers.host}${req.originalUrl}`);
    }
    next();
  });
}

if (require.main === module) {
  app.listen(env.PORT, () => {
    require("./utils/logger").info(`Secure server running on port ${env.PORT}`);
    if (env.NODE_ENV !== "test") {
      startBotListener();
      startSupportInboxListener();
      startEmailRetryWorker();
      startVerificationEmailRescueWorker();
    }
  });
}

module.exports = app;
