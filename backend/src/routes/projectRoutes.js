const express = require("express");
const router = express.Router();

const {
  createProject,
  listProjects,
  rotateProjectApiKey,
  getEmbedSnippet,
} = require("../controllers/projectController");
const { updateBadgeSettings, getBadgeStats } = require("../controllers/badgeController");
const { updateAiInsightsSettings } = require("../controllers/insightController");
const { requireDashboardAuth } = require("../middleware/supabaseAuth");
const { requireProjectOwnership } = require("../middleware/projectOwnership");
const { dashboardRateLimit } = require("../middleware/dashboardRateLimit");

router.use(requireDashboardAuth, dashboardRateLimit);

router.post("/", createProject);
router.get("/", listProjects);
router.post("/:projectId/rotate-key", requireProjectOwnership, rotateProjectApiKey);
router.get("/:projectId/embed", requireProjectOwnership, getEmbedSnippet);
router.patch("/:projectId/badge", requireProjectOwnership, updateBadgeSettings);
router.get("/:projectId/badge", requireProjectOwnership, getBadgeStats);
router.patch("/:projectId/ai-insights", requireProjectOwnership, updateAiInsightsSettings);

module.exports = router;
