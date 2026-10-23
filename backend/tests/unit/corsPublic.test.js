const request = require("supertest");
const app = require("../../src/app");

describe("split CORS policy", () => {
  it("answers collector preflight for any customer origin, without credentials", async () => {
    const res = await request(app)
      .options("/api/v2/collect")
      .set("Origin", "https://some-customer.example")
      .set("Access-Control-Request-Method", "POST")
      .set("Access-Control-Request-Headers", "content-type,x-api-key");
    expect(res.status).toBe(204);
    expect(res.headers["access-control-allow-origin"]).toBe("https://some-customer.example");
    expect(res.headers["access-control-allow-headers"]).toMatch(/x-api-key/i);
    expect(res.headers["access-control-allow-credentials"]).toBeUndefined();
  });

  it("allows file:// pages (Origin: null) on the collector", async () => {
    const res = await request(app)
      .options("/api/v2/collect")
      .set("Origin", "null")
      .set("Access-Control-Request-Method", "POST");
    expect(res.headers["access-control-allow-origin"]).toBe("null");
  });

  it("does NOT grant arbitrary origins on dashboard routes", async () => {
    const res = await request(app)
      .options("/api/projects")
      .set("Origin", "https://attacker.example")
      .set("Access-Control-Request-Method", "GET");
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });
});
