require("dotenv").config();

const { resendPendingVerificationEmails } = require("../services/emailVerificationResendService");

const readArg = (name, fallback) => {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  if (!match) return fallback;
  return match.slice(prefix.length);
};

const hasFlag = (name) => process.argv.includes(`--${name}`);

const main = async () => {
  const summary = await resendPendingVerificationEmails({
    limit: Number(readArg("limit", 100)),
    minAgeMinutes: Number(readArg("min-age-minutes", 5)),
    cooldownHours: Number(readArg("cooldown-hours", 6)),
    maxRescueSends: Number(readArg("max-rescue-sends", 1)),
    dryRun: hasFlag("dry-run"),
  });

  console.log(JSON.stringify(summary, null, 2));
};

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    setTimeout(() => process.exit(process.exitCode || 0), 250);
  });
