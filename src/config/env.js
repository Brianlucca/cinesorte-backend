const { z } = require("zod");
require("dotenv").config();

const envSchema = z.object({
  PORT: z.string().default("3001"),
  FRONTEND_URL: z.string().url(),
  FIREBASE_WEB_API_KEY: z.string().min(1),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  TELEGRAM_CHAT_ID: z.string().min(1),
  RESEND_API_KEY: z.string().optional(),
  SUPPORT_FROM_EMAIL: z.string().email().optional(),
  SUPPORT_TO_EMAIL: z.string().email().optional(),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.string().optional(),
  SMTP_SECURE: z.string().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  IMAP_HOST: z.string().optional(),
  IMAP_PORT: z.string().optional(),
  IMAP_SECURE: z.string().optional(),
  IMAP_USER: z.string().optional(),
  IMAP_PASS: z.string().optional(),
  IMAP_POLL_INTERVAL_MS: z.string().optional(),
  EMAIL_RETRY_INTERVAL_MS: z.string().optional(),
  EMAIL_RETRY_MAX_ATTEMPTS: z.string().optional(),
  VERIFICATION_EMAIL_RESCUE_ENABLED: z.string().optional(),
  VERIFICATION_EMAIL_RESCUE_INTERVAL_MS: z.string().optional(),
  VERIFICATION_EMAIL_RESCUE_LIMIT: z.string().optional(),
  VERIFICATION_EMAIL_RESCUE_MIN_AGE_MINUTES: z.string().optional(),
  VERIFICATION_EMAIL_RESCUE_COOLDOWN_HOURS: z.string().optional(),
  VERIFICATION_EMAIL_RESCUE_MAX_SENDS: z.string().optional(),
  MEMORY_CACHE_MAX_ENTRIES: z.string().optional(),
});

const env = envSchema.parse(process.env);

module.exports = env;
