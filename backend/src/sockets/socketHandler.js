const Project = require("../models/Project");
const ChatMessage = require("../models/ChatMessage");
const { verifySupabaseToken } = require("../lib/verifySupabaseToken");

const MAX_MESSAGE_LENGTH = 2000;

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
        const project = await Project.findOne({ apiKey });
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
      attachDashboardHandlers(io, socket);
    } else {
      attachVisitorHandlers(io, socket);
    }

    socket.on("disconnect", () => {
      // Room membership is cleaned up automatically by Socket.IO.
    });
  });
};

function attachDashboardHandlers(io, socket) {
  console.log(`[socket] dashboard connected: ${socket.id} (user ${socket.data.user.id})`);

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

      const saved = await ChatMessage.create({
        projectId,
        sessionId,
        sender: "founder",
        message: text,
      });

      const payload = {
        sessionId,
        projectId,
        message: text,
        sender: "founder",
        timestamp: saved.createdAt,
      };

      // Canonical event name the visitor SDK listens for.
      io.to(`chat:${projectId}:${sessionId}`).emit("founder_message", payload);
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
  console.log(`[socket] visitor connected: ${socket.id} -> ${room}`);

  socket.on("user_reply", async ({ message } = {}, ack) => {
    try {
      const text = String(message || "")
        .trim()
        .slice(0, MAX_MESSAGE_LENGTH);
      if (!text) throw new Error("Message is empty");

      const saved = await ChatMessage.create({
        projectId: project._id,
        sessionId,
        sender: "user",
        message: text,
      });

      const payload = {
        sessionId,
        projectId: String(project._id),
        message: text,
        sender: "user",
        timestamp: saved.createdAt,
      };

      // Canonical event name the dashboard listens for.
      io.to(`dashboard:${project._id}`).emit("user_reply", payload);
      if (typeof ack === "function") ack({ ok: true });
    } catch (error) {
      if (typeof ack === "function") ack({ ok: false, error: error.message });
      else socket.emit("chat_error", { error: error.message });
    }
  });
}
