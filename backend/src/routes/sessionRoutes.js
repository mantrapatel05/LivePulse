const express = require("express");
const router = express.Router();

const { getActiveSessions } = require("../controllers/sessionController");
const { requireDashboardAuth } = require("../middleware/supabaseAuth");
const { requireProjectOwnership } = require("../middleware/projectOwnership");

router.get("/:projectId/active", requireDashboardAuth, requireProjectOwnership, getActiveSessions);

module.exports = router;
