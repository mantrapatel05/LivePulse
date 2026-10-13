const http = require("http");
const { Server } = require("socket.io");
const { createAdapter } = require("@socket.io/redis-adapter");
const { io: ioClient } = require("socket.io-client");
const { createRedisClient } = require("../../src/shared/redisClient");

/**
 * Spins up two *independent* Socket.IO servers (simulating two API
 * instances behind a load balancer) sharing one Redis pub/sub adapter each
 * — exactly server.js's wiring, just with the auth middleware stripped out
 * since that needs Mongo, which isn't available in this sandbox. What's
 * under test here is the actual cross-instance delivery mechanism, not
 * project/session auth (which is covered elsewhere with mocks).
 */
async function startInstance() {
  const httpServer = http.createServer();
  const io = new Server(httpServer);
  const pubClient = createRedisClient("pub");
  const subClient = createRedisClient("sub");
  io.adapter(createAdapter(pubClient, subClient));

  await new Promise((resolve) => httpServer.listen(0, resolve));
  const port = httpServer.address().port;

  return {
    io,
    port,
    close: async () => {
      io.close();
      await new Promise((resolve) => httpServer.close(resolve));
      await pubClient.quit();
      await subClient.quit();
    },
  };
}

function connectClient(port) {
  return ioClient(`http://localhost:${port}`, { transports: ["websocket"], forceNew: true });
}

function waitFor(socket, event, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out waiting for "${event}"`)), timeoutMs);
    socket.once(event, (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

describe("Socket.IO Redis adapter — cross-instance room fan-out", () => {
  let instanceA;
  let instanceB;

  beforeEach(async () => {
    instanceA = await startInstance();
    instanceB = await startInstance();
    // The adapter's SUBSCRIBE to Redis completes asynchronously after
    // construction; giving it a brief moment to settle avoids a race on
    // the very first cross-instance emit right after boot.
    await new Promise((resolve) => setTimeout(resolve, 300));
  });

  afterEach(async () => {
    await instanceA.close();
    await instanceB.close();
  });

  it("a room emit from instance A reaches a socket connected only to instance B", async () => {
    const clientOnB = connectClient(instanceB.port);
    await waitFor(clientOnB, "connect");

    // The socket only exists on instance B's local process — instance A
    // has never seen this connection. Room membership itself has to be
    // synced through Redis for this to work at all.
    instanceB.io.sockets.sockets.get(clientOnB.id).join("project:proj1");

    const received = waitFor(clientOnB, "live:event");
    instanceA.io.to("project:proj1").emit("live:event", { hello: "from instance A" });

    const payload = await received;
    expect(payload).toEqual({ hello: "from instance A" });

    clientOnB.disconnect();
  });

  it("does not leak a room broadcast to a socket that never joined that room", async () => {
    const clientOnB = connectClient(instanceB.port);
    await waitFor(clientOnB, "connect");
    // deliberately does NOT join "project:proj1"

    let received = false;
    clientOnB.on("live:event", () => {
      received = true;
    });

    instanceA.io.to("project:proj1").emit("live:event", { hello: "should not arrive" });
    await new Promise((resolve) => setTimeout(resolve, 500));

    expect(received).toBe(false);
    clientOnB.disconnect();
  });

  it("chat-style room isolation holds across instances: only the matching session room receives it", async () => {
    const visitorOnB = connectClient(instanceB.port);
    await waitFor(visitorOnB, "connect");
    instanceB.io.sockets.sockets.get(visitorOnB.id).join("chat:proj1:sessA");

    const otherVisitorOnB = connectClient(instanceB.port);
    await waitFor(otherVisitorOnB, "connect");
    instanceB.io.sockets.sockets.get(otherVisitorOnB.id).join("chat:proj1:sessB");

    let otherReceived = false;
    otherVisitorOnB.on("founder_message", () => {
      otherReceived = true;
    });

    const received = waitFor(visitorOnB, "founder_message");
    instanceA.io.to("chat:proj1:sessA").emit("founder_message", { text: "hey sessA" });

    const payload = await received;
    expect(payload).toEqual({ text: "hey sessA" });

    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(otherReceived).toBe(false);

    visitorOnB.disconnect();
    otherVisitorOnB.disconnect();
  });
});
