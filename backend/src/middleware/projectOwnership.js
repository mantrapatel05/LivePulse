const mongoose = require("mongoose");
const Project = require("../models/Project");

/**
 * Loads the project referenced by req.params.projectId and verifies it
 * belongs to req.user (set by requireDashboardAuth, which must run first).
 * Sets req.project on success.
 *
 * A visitor holding a project's public API key cannot pass this check —
 * there is no path from api key -> req.user, which is the whole point.
 */
async function requireProjectOwnership(req, res, next) {
  try {
    const { projectId } = req.params;

    if (!req.user) {
      // Defensive: this middleware must run after requireDashboardAuth.
      return res.status(401).json({ message: "Missing dashboard session." });
    }

    if (!projectId || !mongoose.Types.ObjectId.isValid(projectId)) {
      return res.status(400).json({ message: "Invalid projectId" });
    }

    const project = await Project.findById(projectId);
    if (!project) {
      return res.status(404).json({ message: "Project not found" });
    }

    if (String(project.supabaseUserId) !== String(req.user.id)) {
      // 404, not 403 — don't confirm to a stranger that the project exists.
      return res.status(404).json({ message: "Project not found" });
    }

    req.project = project;
    next();
  } catch (error) {
    return res.status(500).json({ message: "Ownership check failed", error: error.message });
  }
}

module.exports = { requireProjectOwnership };
