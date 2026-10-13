const { generateApiKey, hashApiKey } = require("../../src/shared/apiKeyHash");

describe("apiKeyHash", () => {
  it("generates a key with a stable, displayable prefix and a long random tail", () => {
    const { plaintext, prefix, hash } = generateApiKey();
    expect(plaintext.startsWith("lp_live_")).toBe(true);
    expect(prefix).toBe(plaintext.slice(0, prefix.length));
    expect(plaintext.length).toBeGreaterThan(prefix.length + 40);
    expect(hash).toHaveLength(64); // sha256 hex
  });

  it("never generates the same key twice", () => {
    const seen = new Set();
    for (let i = 0; i < 200; i++) seen.add(generateApiKey().plaintext);
    expect(seen.size).toBe(200);
  });

  it("hashing is deterministic for the same input", () => {
    const { plaintext, hash } = generateApiKey();
    expect(hashApiKey(plaintext)).toBe(hash);
  });

  it("a one-character difference produces a completely different hash", () => {
    const a = hashApiKey("lp_live_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    const b = hashApiKey("lp_live_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaab");
    expect(a).not.toBe(b);
  });

  it("the hash never contains the plaintext key as a substring", () => {
    const { plaintext, hash } = generateApiKey();
    expect(hash).not.toContain(plaintext);
  });
});
