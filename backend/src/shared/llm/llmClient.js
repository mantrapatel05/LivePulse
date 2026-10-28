const { withSpan } = require("../tracing");

class LlmUnavailableError extends Error {
  constructor(message = "LLM unavailable", status = null) {
    super(message);
    this.name = "LlmUnavailableError";
    this.status = status;
  }
}

class LlmBadOutputError extends Error {
  constructor(message = "LLM returned unusable output") {
    super(message);
    this.name = "LlmBadOutputError";
  }
}

function config() {
  return {
    key: process.env.LLM_API_KEY,
    model: process.env.LLM_MODEL,
    baseUrl: (process.env.LLM_BASE_URL || "https://openrouter.ai/api/v1").replace(/\/$/, ""),
    timeoutMs: positiveNumber(process.env.LLM_TIMEOUT_MS, 15000),
  };
}

function positiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function isConfigured() {
  const current = config();
  return Boolean(current.key && current.model);
}

function extractJson(text) {
  if (typeof text !== "string") throw new LlmBadOutputError("empty content");
  const stripped = text.replace(/```(?:json)?/gi, "").trim();
  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");
  if (start === -1 || end <= start) throw new LlmBadOutputError("no JSON object");
  try {
    return JSON.parse(stripped.slice(start, end + 1));
  } catch {
    throw new LlmBadOutputError("invalid JSON");
  }
}

async function callOnce({ system, user, maxOutputTokens, timeoutMs }) {
  const current = config();
  let host = "";
  try {
    host = new URL(current.baseUrl).hostname.toLowerCase();
  } catch {
    // Let fetch report an invalid base URL through the normal typed error path.
  }
  const isOpenRouter = host === "openrouter.ai" || host.endsWith(".openrouter.ai");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), positiveNumber(timeoutMs, current.timeoutMs));
  try {
    const response = await fetch(`${current.baseUrl}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${current.key}`,
        "Content-Type": "application/json",
        "HTTP-Referer": process.env.LLM_REFERER || "https://livepulse.app",
        "X-Title": "LivePulse",
      },
      body: JSON.stringify({
        model: current.model,
        temperature: 0.2,
        max_tokens: maxOutputTokens,
        ...(isOpenRouter ? { reasoning: { enabled: false } } : {}),
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });

    if (response.status === 429 || response.status >= 500) {
      throw new LlmUnavailableError("LLM provider temporarily unavailable", response.status);
    }
    if (!response.ok) throw new LlmUnavailableError("LLM provider rejected the request", response.status);

    let body;
    try {
      body = await response.json();
    } catch {
      throw new LlmBadOutputError("non-JSON response");
    }
    if (body?.error) {
      const error = new LlmUnavailableError("LLM provider returned an error");
      error.retryable = true;
      throw error;
    }
    const content = body?.choices?.[0]?.message?.content;
    return {
      json: extractJson(content),
      usage: {
        inputTokens: Number(body?.usage?.prompt_tokens) || 0,
        outputTokens: Number(body?.usage?.completion_tokens) || 0,
      },
      model: typeof body?.model === "string" ? body.model : current.model,
    };
  } catch (error) {
    if (error instanceof LlmUnavailableError || error instanceof LlmBadOutputError) throw error;
    throw new LlmUnavailableError(error?.name === "AbortError" ? "LLM request timed out" : "LLM network request failed");
  } finally {
    clearTimeout(timer);
  }
}

async function generateJson({ system, user, schemaName, maxOutputTokens = 700, timeoutMs }) {
  if (!isConfigured()) throw new LlmUnavailableError("LLM insights are not configured");
  const current = config();
  let attempt = 0;
  while (attempt < 2) {
    try {
      return await withSpan("livepulse.llm.generate", {}, () =>
        callOnce({ system, user, schemaName, maxOutputTokens, timeoutMs }),
      );
    } catch (error) {
      const retryable = error instanceof LlmBadOutputError
        || (error instanceof LlmUnavailableError && (error.retryable || error.status === 429 || error.status >= 500));
      if (!retryable || attempt > 0) throw error;
      attempt += 1;
      await new Promise((resolve) => setTimeout(resolve, 250 + Math.random() * 500));
    }
  }
  throw new LlmUnavailableError("LLM provider temporarily unavailable");
}

module.exports = { generateJson, isConfigured, LlmUnavailableError, LlmBadOutputError, extractJson };
