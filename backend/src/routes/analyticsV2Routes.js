const express = require("express");
const router = express.Router();
const { requireDashboardAuth } = require("../middleware/supabaseAuth");
const { requireProjectOwnership } = require("../middleware/projectOwnership");
const { dashboardRateLimit } = require("../middleware/dashboardRateLimit");
const {
  getOverview,
  getTimeseries,
  getTopPages,
  getEventBreakdown,
  getErrorClusters,
  getSessions,
  getSessionTimeline,
  getProjectHealth,
} = require("../controllers/analyticsV2Controller");

router.use(requireDashboardAuth, dashboardRateLimit);
router.use("/:projectId", requireProjectOwnership);

router.get("/:projectId/overview", getOverview);
router.get("/:projectId/timeseries", getTimeseries);
router.get("/:projectId/top-pages", getTopPages);
router.get("/:projectId/event-breakdown", getEventBreakdown);
router.get("/:projectId/error-clusters", getErrorClusters);
router.get("/:projectId/sessions", getSessions);
router.get("/:projectId/sessions/:sessionId/timeline", getSessionTimeline);
router.get("/:projectId/health", getProjectHealth);

module.exports = router;
