const request = require("supertest");
const app = require("../src/app");
const Event = require("../src/models/Event");
const { connect, closeDatabase, clearDatabase } = require("./helpers/testDb");
const { makeToken } = require("./helpers/authToken");

beforeAll(connect);
afterEach(clearDatabase);
afterAll(closeDatabase);

async function createProject(userId, name = "Proj") {
  const token = makeToken(userId);
  const res = await request(app)
    .post("/api/projects")
    .set("Authorization", `Bearer ${token}`)
    .send({ name });
  return { project: res.body.project, token };
}

describe("Analytics ownership", () => {
  it("rejects a different signed-in user from another project's analytics", async () => {
    const { project } = await createProject("owner-1");
    const strangerToken = makeToken("stranger-1");

    const res = await request(app)
      .get(`/api/analytics/${project._id}/overview`)
      .set("Authorization", `Bearer ${strangerToken}`);

    expect(res.status).toBe(404);
  });

  it("the owner can read their own overview", async () => {
    const { project, token } = await createProject("owner-2");

    const res = await request(app)
      .get(`/api/analytics/${project._id}/overview`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("totalEvents");
    expect(res.body).toHaveProperty("uniqueVisitors");
    expect(res.body).toHaveProperty("avgEngagedSeconds");
  });
});

describe("Overview aggregation", () => {
  it("computes average engaged time from time_on_page events", async () => {
    const { project, token } = await createProject("owner-3");

    await Event.create([
      {
        projectId: project._id,
        sessionId: "s1",
        eventType: "time_on_page",
        url: "https://example.com",
        metadata: { seconds: 10 },
      },
      {
        projectId: project._id,
        sessionId: "s2",
        eventType: "time_on_page",
        url: "https://example.com",
        metadata: { seconds: 30 },
      },
      {
        projectId: project._id,
        sessionId: "s1",
        eventType: "page_view",
        url: "https://example.com",
      },
    ]);

    const res = await request(app)
      .get(`/api/analytics/${project._id}/overview`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.avgEngagedSeconds).toBe(20);
    expect(res.body.totalEvents).toBe(3);
    expect(res.body.uniqueVisitors).toBe(2);
  });
});
