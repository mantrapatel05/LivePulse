const Project = require("../models/Project");
const ChatMessage = require("../models/ChatMessage");
const { verifySupabaseToken } = require("../lib/verifySupabaseToken");
const { resolveApiKey } = require("../shared/resolveApiKey");
const { getRedisClient, checkRedisReady } = require("../shared/redisClient");
const { checkClickhouseReady } = require("../shared/clickhouseClient");
const { pendingCount } = require("../shared/redisStream");
const { logger } = require("../shared/logger");
let socketConnections = { inc: () => {}, dec: () => {} };
try {
  ({ socketConnections } = require("../shared/metrics"));
} catch {}

const MAX_MESSAGE_LENGTH = 2000;
const HEALTH_BROADCAST_MS = 15000;

/**
 * Two connection roles, decided during the handshake and never after:
 *
 *   dashboard — founder's browser. Authenticates with a Supabase access
 *   token (auth.token). Can join project:{id} / dashboard:{id} rooms, but
 *   only for projects it actually owns.
 *
 *   visitor — the embedded SDK on a customer's site. Authenticates with the
 *   project's public API key (auth.apiKey) + a sessionId it generated
 *   itself. Can only ever be in its own chat:{projectId}:{sessionId} room —
 *   there is no handler that lets it join anything else.
 *
 * Mixing these up is exactly the vulnerability this rewrite closes: a
 * visitor should never be able to read the live event stream or another
 * visitor's conversation, no matter what it sends over the wire.
 */
module.exports = (io) => {
  const redis = getRedisClient();

  io.use(async (socket, next) => {
    const { token, apiKey, sessionId } = socket.handshake.auth || {};

    try {
      if (token) {
        const user = await verifySupabaseToken(token);
        socket.data.role = "dashboard";
        socket.data.user = user;
        socket.data.ownedProjectIds = new Set();
        return next();
      }

      if (apiKey) {
        if (!sessionId || typeof sessionId !== "string" || sessionId.length > 200) {
          return next(new Error("sessionId is required for visitor connections"));
        }
        // resolveApiKey, not a raw Project.findOne({apiKey}) — new (V2,
        // hashed-key) projects have no plaintext apiKey field to match
        // against at all, so the naive lookup would silently reject every
        // visitor on every project created after the hashing migration.
        const project = await resolveApiKey(redis, apiKey);
        if (!project) return next(new Error("Invalid API key"));
        socket.data.role = "visitor";
        socket.data.project = project;
        socket.data.sessionId = sessionId;
        return next();
      }

      return next(new Error("Missing credentials: provide token (dashboard) or apiKey (visitor)"));
    } catch (error) {
      return next(new Error(error.message || "Authentication failed"));
    }
  });

  io.on("connection", (socket) => {
    if (socket.data.role === "dashboard") {
      socketConnections.inc({ role: "dashboard" });
      attachDashboardHandlers(io, socket);
    } else {
      socketConnections.inc({ role: "visitor" });
      attachVisitorHandlers(io, socket);
    }

    socket.on("disconnect", () => {
      socketConnections.dec({ role: socket.data.role });
    });
  });

  startHealthBroadcast(io, redis);
};

function attachDashboardHandlers(io, socket) {
  logger.info({ socketId: socket.id, userId: socket.data.user.id }, "dashboard socket connected");

  socket.on("join_project", async ({ projectId } = {}, ack) => {
    try {
      const project = await Project.findById(projectId);
      if (!project || String(project.supabaseUserId) !== String(socket.data.user.id)) {
        if (typeof ack === "function") ack({ ok: false, error: "Project not found" });
        return;
      }

      socket.data.ownedProjectIds.add(String(projectId));
      socket.join(`project:${projectId}`);
      socket.join(`dashboard:${projectId}`);

      if (typeof ack === "function") ack({ ok: true });
      else socket.emit("joined", { projectId });
    } catch (error) {
      if (typeof ack === "function") ack({ ok: false, error: error.message });
    }
  });

  socket.on("join_chat", ({ projectId, sessionId } = {}) => {
    if (!socket.data.ownedProjectIds.has(String(projectId))) return;
    socket.join(`chat:${projectId}:${sessionId}`);
  });

  socket.on("send_chat", async ({ projectId, sessionId, message } = {}, ack) => {
    try {
      if (!socket.data.ownedProjectIds.has(String(projectId))) {
        throw new Error("Not authorized for this project");
      }
      const text = String(message || "")
        .trim()
        .slice(0, MAX_MESSAGE_LENGTH);
      if (!text) throw new Error("Message is empty");

      const saved = await ChatMessage.create({ projectId, sessionId, sender: "founder", message: text });
      const payload = { sessionId, projectId, message: text, sender: "founder", timestamp: saved.createdAt };

      const room = `chat:${projectId}:${sessionId}`;
      io.to(room).emit("chat:message", payload); // canonical (V2)
      io.to(room).emit("founder_message", payload); // V1 alias, compatibility window
      if (typeof ack === "function") ack({ ok: true, message: payload });
    } catch (error) {
      if (typeof ack === "function") ack({ ok: false, error: error.message });
      else socket.emit("chat_error", { error: error.message });
    }
  });
}

function attachVisitorHandlers(io, socket) {
  const { project, sessionId } = socket.data;
  const room = `chat:${project._id}:${sessionId}`;
  socket.join(room);
  logger.info({ socketId: socket.id, room }, "visitor socket connected");

  socket.on("user_reply", async ({ message } = {}, ack) => {
    try {
      const text = String(message || "")
        .trim()
        .slice(0, MAX_MESSAGE_LENGTH);
      if (!text) throw new Error("Message is empty");

      const saved = await ChatMessage.create({ projectId: project._id, sessionId, sender: "user", message: text });
      const payload = {
        sessionId,
        projectId: String(project._id),
        message: text,
        sender: "user",
        timestamp: saved.createdAt,
      };

      const dashboardRoom = `dashboard:${project._id}`;
      io.to(dashboardRoom).emit("chat:message", payload); // canonical (V2)
      io.to(dashboardRoom).emit("user_reply", payload); // V1 alias, compatibility window
      if (typeof ack === "function") ack({ ok: true });
    } catch (error) {
      if (typeof ack === "function") ack({ ok: false, error: error.message });
      else socket.emit("chat_error", { error: error.message });
    }
  });
}

/**
 * Periodic system:health push so a connected dashboard's queue/connection
 * indicator updates without waiting on its own poll interval. This is a
 * broadcast to every socket, not per-project — it reports the shared
 * events:v2 pipeline's health, which is genuinely process-wide (see the
 * same caveat in healthController.getProjectHealth).
 */
function startHealthBroadcast(io, redis) {
  const timer = setInterval(async () => {
    try {
      const [redisOk, clickhouseOk, pending] = await Promise.all([
        checkRedisReady(),
        checkClickhouseReady(),
        pendingCount(redis),
      ]);
      io.emit("system:health", {
        redisOk,
        clickhouseOk,
        streamPendingCountProcessWide: pending,
        at: new Date().toISOString(),
      });
    } catch (err) {
      logger.warn({ err: err.message }, "system:health broadcast failed");
    }
  }, HEALTH_BROADCAST_MS);
  timer.unref?.(); // don't hold the process open just for this
}
