const Project = require("../src/models/Project");
const { isValidPublicId } = require("../src/shared/publicId");
const { backfillPublicIds } = require("../scripts/backfillPublicId");
const { connect, closeDatabase, clearDatabase } = require("./helpers/testDb");

beforeAll(connect);
beforeEach(clearDatabase);
afterAll(closeDatabase);

describe("backfillPublicIds", () => {
  it("assigns unique ids and is idempotent", async () => {
    await Project.create([
      { name: "One", supabaseUserId: "u1" },
      { name: "Two", supabaseUserId: "u1" },
      { name: "Three", supabaseUserId: "u1" },
    ]);

    expect(await backfillPublicIds()).toBe(3);
    const projects = await Project.find().sort({ name: 1 }).lean();
    const ids = projects.map((project) => project.publicId);
    expect(ids.every(isValidPublicId)).toBe(true);
    expect(new Set(ids).size).toBe(3);

    expect(await backfillPublicIds()).toBe(0);
    const unchanged = await Project.find().sort({ name: 1 }).lean();
    expect(unchanged.map((project) => project.publicId)).toEqual(ids);
  });

  it("retries a duplicate id collision", async () => {
    await Project.init();
    await Project.create([
      { name: "One", supabaseUserId: "u1" },
      { name: "Two", supabaseUserId: "u1" },
    ]);
    const repeated = "123456789abc";
    let calls = 0;
    const generate = () => {
      calls++;
      return calls <= 2 ? repeated : `abcdefghjkm${calls}`;
    };

    await expect(backfillPublicIds({ generate })).resolves.toBe(2);
    const ids = (await Project.find().lean()).map((project) => project.publicId);
    expect(new Set(ids).size).toBe(2);
  });
});
