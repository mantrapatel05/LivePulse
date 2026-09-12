const crypto = require("crypto");
const Project = require("../models/Project");

function generateApiKey() {
  return `lp_${crypto.randomBytes(24).toString("hex")}`;
}

// POST /api/projects — owner is always the verified session user, never a
// client-supplied field. This is the fix for the old "trust me, this is my
// user id" query-param model.
const createProject = async (req, res) => {
  try {
    const { name } = req.body || {};

    if (!name || !String(name).trim()) {
      return res.status(400).json({ message: "name is required" });
    }

    const project = await Project.create({
      name: String(name).trim(),
      supabaseUserId: req.user.id,
      apiKey: generateApiKey(),
    });

    return res.status(201).json({
      message: "Project created successfully",
      project,
    });
  } catch (error) {
    return res.status(500).json({
      message: "Failed to create project",
      error: error.message,
    });
  }
};

// GET /api/projects — always scoped to the verified session user.
const listProjects = async (req, res) => {
  try {
    const projects = await Project.find({ supabaseUserId: req.user.id })
      .sort({ createdAt: -1 })
      .lean();

    return res.status(200).json({
      count: projects.length,
      projects,
    });
  } catch (error) {
    return res.status(500).json({
      message: "Failed to fetch projects",
      error: error.message,
    });
  }
};

// POST /api/projects/:projectId/rotate-key — req.project is set by
// requireProjectOwnership, so by the time we get here ownership is proven.
const rotateProjectApiKey = async (req, res) => {
  try {
    req.project.apiKey = generateApiKey();
    await req.project.save();

    return res.status(200).json({
      message: "Project API key rotated successfully",
      project: req.project,
    });
  } catch (error) {
    return res.status(500).json({
      message: "Failed to rotate project API key",
      error: error.message,
    });
  }
};

// GET /api/projects/:projectId/embed — the exact one-tag snippet for this
// project, so the dashboard's "copy install code" button can never drift
// from what the backend actually supports.
const getEmbedSnippet = async (req, res) => {
  try {
    const backendOrigin = (
      process.env.PUBLIC_BACKEND_URL || `${req.protocol}://${req.get("host")}`
    ).replace(/\/$/, "");
    const project = req.project;

    const snippet = `<script src="${backendOrigin}/sdk/livepulse.js" data-key="${project.apiKey}" data-api="${backendOrigin}" data-chat="true" defer></script>`;

    return res.status(200).json({
      projectId: String(project._id),
      apiKey: project.apiKey,
      backendOrigin,
      snippet,
    });
  } catch (error) {
    return res.status(500).json({ message: "Failed to build embed snippet", error: error.message });
  }
};

module.exports = {
  createProject,
  listProjects,
  rotateProjectApiKey,
  getEmbedSnippet,
};
