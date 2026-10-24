const { generatePublicId, isValidPublicId } = require("../../src/shared/publicId");

describe("publicId", () => {
  it("generates unique valid 12-character base58 ids", () => {
    const ids = Array.from({ length: 1000 }, generatePublicId);
    expect(ids.every((id) => isValidPublicId(id))).toBe(true);
    expect(ids.every((id) => id.length === 12)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.join("")).not.toMatch(/[0OIl]/);
  });

  it.each(["", null, "12345678901", "1234567890123", "1234567890a0"])(
    "rejects invalid id %s",
    (id) => {
      expect(isValidPublicId(id)).toBe(false);
    },
  );
});
