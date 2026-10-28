const mockGenerateJson = jest.fn();
jest.mock("../../src/shared/llm/llmClient", () => ({
  generateJson: (...args) => mockGenerateJson(...args),
  LlmBadOutputError: class LlmBadOutputError extends Error {},
}));

const { buildErrorClusterDigest, generateErrorClusterInsight, validateErrorInsight } = require("../../src/shared/insights/errorClusterInsight");

describe("error cluster insight", () => {
  beforeEach(() => mockGenerateJson.mockReset());

  it("scrubs cluster values and includes no more than five representative summaries", () => {
    const { digest } = buildErrorClusterDigest({
      cluster: { signature: "TypeError 42", message: "TypeError: bad at /x?token=secret", occurrences: 9, affected_sessions: 3, last_seen: "2026-10-25 10:00:00" },
      sessions: Array.from({ length: 8 }, (_, index) => ({ digest: { events: [{ id: `e${index}` }] } })),
    });
    expect(digest.representativeSessions).toHaveLength(5);
    expect(JSON.stringify(digest)).not.toContain("token=secret");
  });

  it("caps confidence at medium without a stack-like signal and requires likely language", () => {
    expect(validateErrorInsight({ summary: "A cluster", likelyCause: "Likely a rendering error.", userImpact: "Some sessions fail.", suggestedFix: "Inspect the component.", confidence: "high" }, false).confidence).toBe("medium");
    expect(() => validateErrorInsight({ summary: "A cluster", likelyCause: "It is definitely the network.", userImpact: "Some sessions fail.", suggestedFix: "Inspect it.", confidence: "high" }, true)).toThrow();
  });

  it("requests strictly structured error-cluster output", async () => {
    mockGenerateJson.mockResolvedValue({ json: { summary: "A cluster repeats.", likelyCause: "Likely a request parsing issue.", userImpact: "Some sessions fail to load.", suggestedFix: "Inspect the request parser.", confidence: "low" }, usage: { inputTokens: 9, outputTokens: 8 }, model: "test" });
    const result = await generateErrorClusterInsight({ digest: { cluster: {}, representativeSessions: [] }, hasStackSignal: false });
    expect(result.insight.confidence).toBe("low");
  });
});
