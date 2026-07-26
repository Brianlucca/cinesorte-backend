const env = require("./config/env");
const http = require("node:http");
const createApp = require("./app");
const logger = require("./shared/utils/logger");
const { startBotListener } = require("./infrastructure/monitoring/telegram.service");
const { startExtensionCleanup } = require("./modules/watchProgress/extensionCleanup.service");
const { registerWatchPartyGateway } = require("./modules/watchParty/watchParty.gateway");

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
}

module.exports = app;
