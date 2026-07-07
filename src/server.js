const env = require("./config/env");
const createApp = require("./app");
const logger = require("./shared/utils/logger");
const { startBotListener } = require("./infrastructure/monitoring/telegram.service");

const app = createApp();

if (require.main === module) {
  app.listen(env.PORT, () => {
    logger.info(`Secure server running on port ${env.PORT}`);
    if (env.NODE_ENV !== "test") {
      startBotListener();
    }
  });
}

module.exports = app;
