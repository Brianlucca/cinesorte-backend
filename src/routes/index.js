const tmdbRoutes = require("../modules/tmdb/tmdb.routes");
const interactionRoutes = require("../modules/interactions/interaction.routes");
const socialRoutes = require("../modules/social/social.routes");
const authRoutes = require("../modules/auth/auth.routes");
const notificationRoutes = require("../modules/notifications/notification.routes");
const messageRoutes = require("../modules/messages/message.routes");
const { tmdbApiLimiter, messageLimiter } = require("../shared/middleware/security");

const registerRoutes = (app) => {
  app.get("/", (req, res) => res.json({ message: "Cinesorte Secure API" }));
  app.get("/api/health", (req, res) => res.sendStatus(200));

  app.use("/api/tmdb", tmdbApiLimiter, tmdbRoutes);
  app.use("/api/users", authRoutes);
  app.use("/api/users", interactionRoutes);
  app.use("/api/social", socialRoutes);
  app.use("/api/notifications", notificationRoutes);
  app.use("/api/messages", messageLimiter, messageRoutes);
};

module.exports = registerRoutes;
