const { createLogger, format, transports } = require('winston');
const env = require('../config/env');

const LOG_TIMEZONE = 'America/Bahia';

const getBahiaTimestamp = () => {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('pt-BR', {
    timeZone: LOG_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  return `${formatter.format(now)} ${LOG_TIMEZONE}`;
};

const timestampFormat = format((info) => {
  info.timestamp = getBahiaTimestamp();
  return info;
});

const serializeInfo = (info) => {
  const payload = {
    timestamp: info.timestamp,
    level: info.level,
    message: info.message,
  };

  for (const [key, value] of Object.entries(info)) {
    if (!['timestamp', 'level', 'message'].includes(key) && key !== 'stack') {
      payload[key] = value;
    }
  }

  if (info.stack) {
    payload.stack = info.stack;
  }

  return payload;
};

const fileFormat = format.combine(
  timestampFormat(),
  format.errors({ stack: true }),
  format.splat(),
  format.printf((info) => `${JSON.stringify(serializeInfo(info))}\n`)
);

const consoleFormat = format.combine(
  timestampFormat(),
  format.errors({ stack: true }),
  format.splat(),
  format.printf((info) => {
    const payload = serializeInfo(info);
    return `[${payload.timestamp}] ${payload.level.toUpperCase()} ${payload.message}\n${JSON.stringify(payload, null, 2)}\n`;
  })
);

const logger = createLogger({
  level: env.NODE_ENV === 'production' ? 'info' : 'debug',
  transports: [
    new transports.File({ filename: 'logs/error.log', level: 'error', format: fileFormat }),
    new transports.File({ filename: 'logs/combined.log', format: fileFormat })
  ]
});

logger.add(new transports.Console({ format: consoleFormat }));

module.exports = logger;
