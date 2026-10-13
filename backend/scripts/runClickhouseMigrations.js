require("dotenv").config();
const { runMigrations } = require("../src/shared/clickhouseClient");
const { logger } = require("../src/shared/logger");

runMigrations()
  .then(() => {
    logger.info("clickhouse migrations applied successfully");
    process.exit(0);
  })
  .catch((err) => {
    logger.error({ err }, "clickhouse migrations failed");
    process.exit(1);
  });
