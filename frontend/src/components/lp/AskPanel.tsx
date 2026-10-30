import { useState, type FormEvent } from "react";
import { ApiError } from "../../lib/api";
import { analyticsV2, type NlqResult } from "../../lib/apiV2";
import { Bars, Empty, Panel, Spark, Stat } from "./Panel";

const EXAMPLES = [
  "rage clicks on mobile last week",
  "top pages by errors yesterday",
  "sessions per day last 7 days",
];

const formatValue = (value: number | null) =>
  value == null ? "—" : Number.isInteger(value) ? value.toLocaleString() : value.toFixed(1);

function errorCopy(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 403)
      return "AI features are off. Enable AI session insights in the project's Install settings.";
    if (error.status === 409)
      return "Ask is available after this project is migrated to ClickHouse.";
    if (error.status === 429) {
      if (error.resetsAt)
        return `Daily limit reached. Resets at ${new Date(error.resetsAt).toLocaleTimeString()}.`;
      if (error.retryAfterSeconds)
        return `Rate limit reached. Try again in ${error.retryAfterSeconds} seconds.`;
      return "Question limit reached. Try again later.";
    }
    if (error.status === 503) return "AI isn't configured on this server.";
    return error.message;
  }
  return error instanceof Error ? error.message : "Couldn't run that question.";
}

export function AskPanel({ projectId }: { projectId: string }) {
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<NlqResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(text: string) {
    const normalized = text.trim();
    if (!normalized) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const response = await analyticsV2(projectId).ask(normalized);
      if (!("data" in response)) {
        setError("That question is already being interpreted. Try again shortly.");
        return;
      }
      setResult(response.data);
    } catch (caught) {
      setError(errorCopy(caught));
    } finally {
      setBusy(false);
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void run(question);
  }

  return (
    <Panel label="ask" title="natural-language query" className="span-12">
      <form className="lp-ask-form" onSubmit={onSubmit}>
        <input
          className="lp-input"
          value={question}
          maxLength={300}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="e.g. rage clicks on mobile last week"
          aria-label="Ask a question about your analytics"
        />
        <button className="lp-btn small" type="submit" disabled={busy || !question.trim()}>
          {busy ? "thinking…" : "ask"}
        </button>
      </form>
      <div className="lp-ask-examples">
        {EXAMPLES.map((example) => (
          <button
            key={example}
            type="button"
            className="lp-btn-link"
            disabled={busy}
            onClick={() => {
              setQuestion(example);
              void run(example);
            }}
          >
            {example}
          </button>
        ))}
      </div>

      {error && (
        <div className="lp-alert" role="alert">
          {error}
        </div>
      )}
      {result && result.status !== "ok" && (
        <div className="lp-alert warn" role="status">
          <b>{result.status === "unsupported" ? "Can't do that" : "No answer"}</b>
          {result.message}
        </div>
      )}
      {result?.status === "ok" && <AskResult result={result} />}
      <small className="lp-ai-disclaimer">AI-interpreted. Check the "understood as" line.</small>
    </Panel>
  );
}

function AskResult({ result }: { result: Extract<NlqResult, { status: "ok" }> }) {
  const { spec, rows } = result;
  const timeGroup = spec.groupBy === "hour" || spec.groupBy === "day";
  const metricLabel = result.columns.find((column) => column.key === "value")?.label ?? "value";

  return (
    <div className="lp-ask-result" aria-live="polite">
      <div className="lp-ai-result-meta">
        <span>Understood as:</span>
        <span className="lp-chip">
          <i />
          {result.interpreted}
        </span>
        {result.cached && <span className="lp-ai-tag">cached interpretation</span>}
      </div>
      {rows.length === 0 ? (
        <Empty>No data matched that question.</Empty>
      ) : !spec.groupBy ? (
        <div className="lp-stat-deck">
          <Stat label={metricLabel} value={formatValue(rows[0].value)} />
        </div>
      ) : timeGroup ? (
        <div className="lp-spark-wrap">
          <Spark points={rows.map((row) => row.value ?? 0)} />
          <span className="lp-stat-hint">
            {rows.length} buckets · {rows[0].label?.slice(0, 16).replace("T", " ")} →{" "}
            {rows[rows.length - 1].label?.slice(0, 16).replace("T", " ")} UTC
          </span>
        </div>
      ) : (
        <Bars
          rows={rows.map((row, index) => ({
            key: `${index}-${row.label}`,
            label: row.label || "(unknown)",
            value: row.value ?? 0,
            sub: formatValue(row.value),
          }))}
        />
      )}
      {result.truncated && (
        <small className="lp-stat-hint">Showing the first {rows.length} rows.</small>
      )}
    </div>
  );
}
