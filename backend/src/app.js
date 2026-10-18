const path = require("path");
const express = require("express");
const cors = require("cors");

const eventRoutes = require("./routes/eventRoutes");
const sessionRoutes = require("./routes/sessionRoutes");
const projectRoutes = require("./routes/projectRoutes");
const analyticsRoutes = require("./routes/analyticsRoutes");
const chatRoutes = require("./routes/chatRoutes");
const collectRoutes = require("./routes/collectRoutes");
const healthRoutes = require("./routes/healthRoutes");
const analyticsV2Routes = require("./routes/analyticsV2Routes");
const { register } = require("./shared/metrics");
const { corsOrigin } = require("./config/corsOrigin");
const { requireMetricsAuth } = require("./middleware/metricsAuth");
const { logger } = require("./shared/logger");

const app = express();

app.set("trust proxy", 1);
app.use(cors({ origin: corsOrigin, credentials: true }));
app.use(express.json());

// The embeddable SDK is a public, static asset — same trust level as the
// script tag itself. Served from the backend so the dashboard's generated
// embed snippet and the actual file always match.
app.use(
  "/sdk",
  express.static(path.join(__dirname, "../public/sdk"), {
    maxAge: "5m",
    setHeaders(res) {
      res.setHeader("Access-Control-Allow-Origin", "*");
    },
  }),
);

app.use("/api/events", eventRoutes);
app.use("/api/sessions", sessionRoutes);
app.use("/api/projects", projectRoutes);
app.use("/api/analytics", analyticsRoutes);
app.use("/api/v2/projects", analyticsV2Routes);
app.use("/api/chat", chatRoutes);
app.use("/api/v2/collect", collectRoutes);
app.use("/health", healthRoutes);

app.get("/metrics", requireMetricsAuth, async (_req, res) => {
  res.set("Content-Type", register.contentType);
  res.end(await register.metrics());
});

app.get("/", (req, res) => {
  res.send("Welcome to the LivePulse API");
});

app.use((err, _req, res, next) => {
  if (res.headersSent) return next(err);
  const status = Number(err.statusCode || err.status) || 500;
  if (status >= 500) logger.error({ err }, "request failed");
  return res.status(status).json({
    message: status >= 500 ? "Internal server error." : err.message || "Request failed.",
  });
});

module.exports = app;
