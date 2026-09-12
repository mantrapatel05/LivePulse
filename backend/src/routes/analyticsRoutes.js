const express = require("express");
const router = express.Router();

const {
  getOverview,
  getTopPages,
  getEventsOverTime,
  getEventBreakdown,
  getSessionTimeline,
  getErrorClusters,
} = require("../controllers/analyticsController");
const { requireDashboardAuth } = require("../middleware/supabaseAuth");
const { requireProjectOwnership } = require("../middleware/projectOwnership");

router.use(requireDashboardAuth);
router.use('/:projectId', requireProjectOwnership);

router.get("/:projectId/overview", getOverview);
router.get("/:projectId/events-over-time", getEventsOverTime);
router.get("/:projectId/top-pages", getTopPages);
router.get("/:projectId/event-breakdown", getEventBreakdown);
router.get("/:projectId/sessions/:sessionId/timeline", getSessionTimeline);
router.get("/:projectId/error-clusters", getErrorClusters);

module.exports = router;
