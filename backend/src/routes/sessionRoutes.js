const express = require("express");
const router = express.Router();

const { getActiveSessions } = require("../controllers/sessionController");
const { requireDashboardAuth } = require("../middleware/supabaseAuth");
const { requireProjectOwnership } = require("../middleware/projectOwnership");
const { dashboardRateLimit } = require("../middleware/dashboardRateLimit");

router.get("/:projectId/active", requireDashboardAuth, dashboardRateLimit, requireProjectOwnership, getActiveSessions);

module.exports = router;
