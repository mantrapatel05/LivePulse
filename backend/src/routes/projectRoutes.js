const express = require("express");
const router = express.Router();

const {
  createProject,
  listProjects,
  rotateProjectApiKey,
  getEmbedSnippet,
} = require("../controllers/projectController");
const { requireDashboardAuth } = require("../middleware/supabaseAuth");
const { requireProjectOwnership } = require("../middleware/projectOwnership");

router.use(requireDashboardAuth);

router.post("/", createProject);
router.get("/", listProjects);
router.post("/:projectId/rotate-key", requireProjectOwnership, rotateProjectApiKey);
router.get("/:projectId/embed", requireProjectOwnership, getEmbedSnippet);

module.exports = router;
