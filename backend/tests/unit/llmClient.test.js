jest.mock("../../src/shared/tracing", () => ({ withSpan: (_name, _attrs, fn) => fn() }));

const { generateJson, isConfigured, LlmUnavailableError } = require("../../src/shared/llm/llmClient");

const response = (status, body) => ({
  status,
  ok: status >= 200 && status < 300,
  json: async () => body,
});

describe("OpenRouter-compatible LLM client", () => {
  const originalFetch = global.fetch;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.LLM_API_KEY = "test-key";
    process.env.LLM_MODEL = "test/free-model";
    process.env.LLM_BASE_URL = "https://llm.test/v1";
    process.env.LLM_TIMEOUT_MS = "100";
    global.fetch = jest.fn();
  });
  afterEach(() => {
    global.fetch = originalFetch;
    for (const name of ["LLM_API_KEY", "LLM_MODEL", "LLM_BASE_URL", "LLM_TIMEOUT_MS"]) {
      if (originalEnv[name] === undefined) delete process.env[name];
      else process.env[name] = originalEnv[name];
    }
  });

  it("retries once on 429 and then returns parsed JSON and usage", async () => {
    global.fetch.mockResolvedValueOnce(response(429, {})).mockResolvedValueOnce(response(200, {
      model: "test/free-model",
      choices: [{ message: { content: "```json\n{\"ok\":true}\n```" } }],
      usage: { prompt_tokens: 11, completion_tokens: 7 },
    }));
    await expect(generateJson({ system: "rules", user: "data" })).resolves.toMatchObject({
      json: { ok: true }, usage: { inputTokens: 11, outputTokens: 7 }, model: "test/free-model",
    });
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it("disables OpenRouter reasoning so reasoning tokens leave room for answer content", async () => {
    process.env.LLM_BASE_URL = "https://openrouter.ai/api/v1";
    global.fetch.mockResolvedValue(response(200, {
      model: "test/free-model",
      choices: [{ message: { content: "{\"ok\":true}" } }],
      usage: { prompt_tokens: 2, completion_tokens: 3 },
    }));
    await generateJson({ system: "rules", user: "data" });
    const request = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(request.reasoning).toEqual({ enabled: false });
  });

  it("does not retry a 400 response", async () => {
    global.fetch.mockResolvedValue(response(400, { error: "private provider detail" }));
    await expect(generateJson({ system: "rules", user: "data" })).rejects.toBeInstanceOf(LlmUnavailableError);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("maps an abort timeout to LlmUnavailableError", async () => {
    global.fetch.mockImplementation((_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
    }));
    await expect(generateJson({ system: "rules", user: "data", timeoutMs: 1 })).rejects.toMatchObject({ name: "LlmUnavailableError" });
  });

  it("reports missing credentials as unconfigured without making a request", async () => {
    delete process.env.LLM_API_KEY;
    expect(isConfigured()).toBe(false);
    await expect(generateJson({ system: "rules", user: "data" })).rejects.toBeInstanceOf(LlmUnavailableError);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
