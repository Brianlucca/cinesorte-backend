const env = require("./config/env");
const http = require("node:http");
const createApp = require("./app");
const logger = require("./shared/utils/logger");
const { startBotListener } = require("./infrastructure/monitoring/telegram.service");
const { startExtensionCleanup } = require("./modules/watchProgress/extensionCleanup.service");
const { registerWatchPartyGateway } = require("./modules/watchParty/watchParty.gateway");
const { close: closeCache } = require("./shared/cache/cache.service");

const app = createApp();

if (require.main === module) {
  const server = http.createServer(app);
  registerWatchPartyGateway(server);
  server.listen(env.PORT, () => {
    logger.info(`Secure server running on port ${env.PORT}`);
    if (env.NODE_ENV !== "test") {
      startBotListener();
      startExtensionCleanup();
    }
  });

  const shutdown = (signal) => {
    logger.info("server_shutdown_started", { signal });
    server.close(async () => {
      await closeCache();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000).unref();
  };

  process.once("SIGTERM", () => shutdown("SIGTERM"));
  process.once("SIGINT", () => shutdown("SIGINT"));
}

module.exports = app;
