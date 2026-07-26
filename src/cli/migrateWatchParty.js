const fs = require("node:fs/promises");
const path = require("node:path");
const { getPool, closePool } = require("../config/postgres");

const LOCK_ID = 72910421;

async function migrate() {
  const client = await getPool().connect();
  const migrationsDirectory = path.join(__dirname, "../infrastructure/database/migrations");
  try {
    await client.query("SELECT pg_advisory_lock($1)", [LOCK_ID]);
    await client.query(`CREATE TABLE IF NOT EXISTS watch_party_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    const applied = new Set((await client.query("SELECT name FROM watch_party_migrations")).rows.map(({ name }) => name));
    const files = (await fs.readdir(migrationsDirectory)).filter((file) => file.endsWith(".sql")).sort();
    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = await fs.readFile(path.join(migrationsDirectory, file), "utf8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO watch_party_migrations (name) VALUES ($1)", [file]);
        await client.query("COMMIT");
        console.log(`Applied ${file}.`);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [LOCK_ID]).catch(() => undefined);
    client.release();
  }
}

migrate().catch((error) => { console.error("Watch Party migration failed:", error.message); process.exitCode = 1; }).finally(closePool);
