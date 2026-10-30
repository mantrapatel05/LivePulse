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
const { explainSession, explainErrorCluster } = require("../controllers/insightController");
const { askAnalytics } = require("../controllers/nlqController");
const { getEngagementDrift } = require("../controllers/engagementController");

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
router.get("/:projectId/engagement-drift", getEngagementDrift);
router.post("/:projectId/sessions/:sessionId/insight", explainSession);
router.post("/:projectId/error-clusters/insight", explainErrorCluster);
router.post("/:projectId/ask", askAnalytics);

module.exports = router;
