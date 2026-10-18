const express = require("express");
const router = express.Router();

const { getChatHistory } = require("../controllers/chatController");
const { requireDashboardAuth } = require("../middleware/supabaseAuth");
const { requireProjectOwnership } = require("../middleware/projectOwnership");
const { dashboardRateLimit } = require("../middleware/dashboardRateLimit");

router.get(
  "/:projectId/:sessionId/history",
  requireDashboardAuth,
  dashboardRateLimit,
  requireProjectOwnership,
  getChatHistory,
);

module.exports = router;
