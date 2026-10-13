const fs = require("fs");
const path = require("path");
const { createClient } = require("@clickhouse/client");
const { logger } = require("./logger");

let sharedClient = null;

function getClickhouseClient() {
  if (sharedClient) return sharedClient;
  sharedClient = createClient({
    url: process.env.CLICKHOUSE_URL || "http://localhost:8123",
    username: process.env.CLICKHOUSE_USER || "default",
    password: process.env.CLICKHOUSE_PASSWORD || "",
    database: process.env.CLICKHOUSE_DATABASE || "default",
    clickhouse_settings: {
      async_insert: 1,
      wait_for_async_insert: 1,
    },
  });
  return sharedClient;
}

async function insertEvents(rows) {
  if (!rows.length) return;
  const client = getClickhouseClient();
  await client.insert({
    table: "events_v2",
    values: rows,
    format: "JSONEachRow",
  });
}

async function checkClickhouseReady(timeoutMs = 1500) {
  try {
    const client = getClickhouseClient();
    const result = await Promise.race([
      client.query({ query: "SELECT 1", format: "JSONEachRow" }),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), timeoutMs)),
    ]);
    await result.json();
    return true;
  } catch (err) {
    logger.warn({ err: err.message }, "clickhouse readiness check failed");
    return false;
  }
}

/** Applies clickhouse/migrations/*.sql in filename order. Each statement is idempotent (IF NOT EXISTS). */
async function runMigrations(migrationsDir = path.join(__dirname, "../../clickhouse/migrations")) {
  const client = getClickhouseClient();
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
    const statements = splitStatements(sql);
    logger.info({ file, statements: statements.length }, "applying clickhouse migration");
    for (const statement of statements) {
      await client.command({ query: statement });
    }
  }
  logger.info({ count: files.length }, "clickhouse migrations complete");
}

function splitStatements(sql) {
  const clean = sql
    .split("\n")
    .map((line) => {
      const commentIdx = line.indexOf("--");
      return commentIdx !== -1 ? line.slice(0, commentIdx) : line;
    })
    .join("\n");

  return clean
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

module.exports = { getClickhouseClient, insertEvents, checkClickhouseReady, runMigrations };
