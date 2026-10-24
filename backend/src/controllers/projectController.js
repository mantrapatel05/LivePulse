const Project = require("../models/Project");
const { generateApiKey } = require("../shared/apiKeyHash");
const { invalidateApiKeyCache } = require("../shared/resolveApiKey");
const { getRedisClient } = require("../shared/redisClient");
const { generatePublicId, isValidPublicId } = require("../shared/publicId");

// POST /api/projects — owner is always the verified session user, never a
// client-supplied field. This is the fix for the old "trust me, this is my
// user id" query-param model.
// Referral is attacker-writable: validate, first-project-only, referrer must exist.
// (A user who already owns a project can never self-refer, so no separate self-check is needed.)
async function resolveReferral(userId, candidate) {
  if (!isValidPublicId(candidate)) return null;
  if ((await Project.countDocuments({ supabaseUserId: userId })) > 0) return null;
  return (await Project.exists({ publicId: candidate })) ? candidate : null;
}

const createProject = async (req, res) => {
  try {
    const { name, referredBy } = req.body || {};
    if (!name || !String(name).trim()) {
      return res.status(400).json({ message: "name is required" });
    }
    const { plaintext, prefix, hash } = generateApiKey();
    const referral = await resolveReferral(req.user.id, referredBy);

    let project;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        project = await Project.create({
          name: String(name).trim(),
          supabaseUserId: req.user.id,
          apiKeyPrefix: prefix,
          apiKeyHash: hash,
          analyticsBackend: "dual",
          publicId: generatePublicId(),
          referredBy: referral,
        });
        break;
      } catch (err) {
        if (err && err.code === 11000 && err.keyPattern && err.keyPattern.publicId && attempt < 4) continue;
        throw err;
      }
    }
    return res.status(201).json({
      message: "Project created successfully",
      project: { ...project.toObject(), apiKey: plaintext },
    });
  } catch (error) {
    return res.status(500).json({ message: "Failed to create project", error: error.message });
  }
};

// GET /api/projects — always scoped to the verified session user.
const listProjects = async (req, res) => {
  try {
    const projects = await Project.find({ supabaseUserId: req.user.id })
      .select("-apiKey -apiKeyHash")
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
    const oldHash = req.project.apiKeyHash;
    const oldPlaintextKey = req.project.apiKey; 

    const { plaintext, prefix, hash } = generateApiKey();
    req.project.apiKeyHash = hash;
    req.project.apiKeyPrefix = prefix;
    req.project.apiKey = undefined; // clear any legacy plaintext key permanently
    await req.project.save();

    const redis = getRedisClient();
    await invalidateApiKeyCache(redis, { hash: oldHash, plaintext: oldPlaintextKey });

    return res.status(200).json({
      message: "Project API key rotated successfully",
      project: { ...req.project.toObject(), apiKey: plaintext },
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

    const snippetTemplate = `<script src="${backendOrigin}/sdk/livepulse.js" data-key="{{API_KEY}}" data-api="${backendOrigin}" data-chat="true" data-consent="required" defer></script>`;

    return res.status(200).json({
      projectId: String(project._id),
      apiKeyPrefix: project.apiKeyPrefix || null,
      backendOrigin,
      snippetTemplate,
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
