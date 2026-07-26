const { Pool } = require("pg");
const env = require("./env");

let pool;

const getPool = () => {
  if (!env.DATABASE_URL) {
    throw new Error("DATABASE_URL não configurada para o Watch Party.");
  }
  if (!pool) {
    pool = new Pool({
      connectionString: env.DATABASE_URL,
      ssl: env.NODE_ENV === "production" ? { rejectUnauthorized: false } : undefined,
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
      statement_timeout: 15000,
    });
  }
  return pool;
};

const query = (text, params) => getPool().query(text, params);

const closePool = async () => {
  if (pool) await pool.end();
  pool = undefined;
};

module.exports = { getPool, query, closePool };
