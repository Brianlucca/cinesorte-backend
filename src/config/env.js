const { z } = require("zod");
require("dotenv").config();

const envSchema = z.object({
  PORT: z.string().default("3001"),
  FRONTEND_URL: z.string().url(),
  FIREBASE_WEB_API_KEY: z.string().min(1),
  FIREBASE_DATABASE_URL: z.string().url().optional(),
  MESSAGE_ENCRYPTION_SECRET: z.string().min(32).optional(),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  TELEGRAM_CHAT_ID: z.string().min(1),
  VERIFICATION_EMAIL_RESCUE_ENABLED: z.string().optional(),
  VERIFICATION_EMAIL_RESCUE_INTERVAL_MS: z.string().optional(),
  VERIFICATION_EMAIL_RESCUE_LIMIT: z.string().optional(),
  VERIFICATION_EMAIL_RESCUE_MIN_AGE_MINUTES: z.string().optional(),
  VERIFICATION_EMAIL_RESCUE_COOLDOWN_HOURS: z.string().optional(),
  VERIFICATION_EMAIL_RESCUE_MAX_SENDS: z.string().optional(),
  ACCOUNT_DELETION_CLEANUP_ENABLED: z.string().optional(),
  ACCOUNT_DELETION_CLEANUP_INTERVAL_MS: z.string().optional(),
  ACCOUNT_DELETION_CLEANUP_LIMIT: z.string().optional(),
  MEMORY_CACHE_MAX_ENTRIES: z.string().optional(),
});

const env = envSchema.parse(process.env);

module.exports = env;
