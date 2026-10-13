const env = require("../../config/env");
const { db } = require("../../config/firebase");
const { query } = require("../../config/postgres");
const { checkRedis } = require("../cache/cache.service");

const HEALTH_CHECK_TIMEOUT_MS = 2500;

async function runCheck(check) {
  let timeout;
  try {
    return await Promise.race([
      Promise.resolve().then(check),
      new Promise((resolve) => {
        timeout = setTimeout(() => resolve("timeout"), HEALTH_CHECK_TIMEOUT_MS);
      }),
    ]);
  } catch {
    return "unavailable";
  } finally {
    clearTimeout(timeout);
  }
}

const live = (req, res) => {
  res.set("Cache-Control", "no-store");
  res.status(200).json({ status: "ok" });
};

const ready = async (req, res) => {
  const [firestore, redis, postgres] = await Promise.all([
    runCheck(async () => {
      await db.listCollections();
      return "ok";
    }),
    env.REDIS_URL
      ? runCheck(checkRedis)
      : Promise.resolve("not_configured"),
    env.DATABASE_URL
      ? runCheck(async () => {
          await query("SELECT 1");
          return "ok";
        })
      : Promise.resolve("not_configured"),
  ]);
  const checks = { firestore, redis, postgres };
  const isReady = Object.values(checks).every(
    (status) => status === "ok" || status === "not_configured",
  );

  res.set("Cache-Control", "no-store");
  res.status(isReady ? 200 : 503).json({
    status: isReady ? "ok" : "unavailable",
    checks,
  });
};

module.exports = { live, ready };
