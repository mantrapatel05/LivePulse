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
const { register } = require("./shared/metrics");
const { corsOrigin } = require("./config/corsOrigin");

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
app.use("/api/chat", chatRoutes);
app.use("/api/v2/collect", collectRoutes);
app.use("/health", healthRoutes);

app.get("/metrics", async (_req, res) => {
  res.set("Content-Type", register.contentType);
  res.end(await register.metrics());
});

app.get("/", (req, res) => {
  res.send("Welcome to the LivePulse API");
});

module.exports = app;
