const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const helmet = require("helmet");

const env = require("./config/env");
const corsOptions = require("./config/cors");
const errorHandler = require("./shared/middleware/error");
const notFound = require("./shared/middleware/notFound");
const {
  sanitizeInput,
  shield,
  protectStateChangingRequests,
  userSpamDetector,
} = require("./shared/middleware/security");
const registerRoutes = require("./routes");

const createApp = () => {
  const app = express();

  if (env.NODE_ENV === "production") {
    app.set("trust proxy", 1);
    app.use((req, res, next) => {
      if (
        req.headers["x-forwarded-proto"] &&
        req.headers["x-forwarded-proto"] !== "https"
      ) {
        return res.redirect(301, `https://${req.headers.host}${req.originalUrl}`);
      }
      return next();
    });
  }

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

  registerRoutes(app);

  app.use(notFound);
  app.use(errorHandler);

  return app;
};

module.exports = createApp;
