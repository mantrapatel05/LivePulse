import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { livepulseApi } from "../../lib/api";
import { getDashboardSocket } from "../../lib/socket";
import { clock, toArray } from "../../lib/usePolling";
import { Empty } from "./Panel";

type Row = Record<string, unknown>;
type Msg = { id: string; from: "founder" | "user"; text: string; at: number };

function normalise(raw: Row, i: number): Msg {
  const from =
    String(raw?.sender ?? raw?.from ?? "user").toLowerCase() === "founder" ? "founder" : "user";
  const ts = raw?.timestamp;
  return {
    id: String(raw?._id ?? raw?.id ?? `m${i}-${ts ?? i}`),
    from,
    text: String(raw?.message ?? raw?.text ?? raw?.content ?? ""),
    at: ts ? Date.parse(String(ts)) || Date.now() : Date.now(),
  };
}

export function ChatDock({
  projectId,
  sessionId,
}: {
  projectId: string;
  sessionId: string | null;
}) {
  const api = useMemo(() => livepulseApi(projectId), [projectId]);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const feedRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMessages([]);
    setError(null);
    if (!sessionId) return;
    let alive = true;
    api
      .chatHistory(sessionId)
      .then((res) => {
        if (!alive) return;
        setMessages(toArray<Row>(res, "messages", "history").map(normalise));
      })
      .catch((err) => alive && setError(err instanceof Error ? err.message : "No chat history."));
    return () => {
      alive = false;
    };
  }, [api, sessionId]);

  useEffect(() => {
    if (!sessionId) return;
    const socket = getDashboardSocket();

    // We don't listen for our own "founder_message" echo here — the send()
    // handler below appends it optimistically the instant it's sent, and
    // there's no per-message id from the server yet to dedupe against.
    const onUserReply = (payload: Row) => {
      if (String(payload?.sessionId) !== sessionId) return;
      setMessages((m) => [...m, normalise({ ...payload, sender: "user" }, m.length)]);
    };

    socket.on("user_reply", onUserReply);
    return () => {
      socket.off("user_reply", onUserReply);
    };
  }, [sessionId]);

  useEffect(() => {
    feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight });
  }, [messages]);

  function send(e: FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text || !sessionId) return;
    const socket = getDashboardSocket();
    socket.emit(
      "send_chat",
      { projectId, sessionId, message: text },
      (ack: { ok: boolean; error?: string }) => {
        if (!ack?.ok) setError(ack?.error ?? "Message failed to send.");
      },
    );
    setMessages((m) => [...m, { id: `local-${m.length}`, from: "founder", text, at: Date.now() }]);
    setDraft("");
  }

  if (!sessionId) return <Empty>Select a live session to open the channel to that visitor.</Empty>;

  return (
    <div className="lp-chat">
      <div className="lp-chat-feed" ref={feedRef}>
        {messages.length === 0 ? (
          <Empty>{error ?? "No messages in this session yet. Say something first."}</Empty>
        ) : (
          messages.map((m) => (
            <div key={m.id} className={`lp-msg is-${m.from}`}>
              <span className="lp-msg-meta">
                {m.from === "founder" ? "you" : "visitor"} · {clock(m.at)}
              </span>
              <p>{m.text}</p>
            </div>
          ))
        )}
      </div>
      <form className="lp-chat-input" onSubmit={send}>
        <input
          className="lp-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={`reply to ${sessionId.slice(0, 8)}…`}
          maxLength={500}
          aria-label="Message to visitor"
        />
        <button className="lp-btn small" type="submit" disabled={!draft.trim()}>
          send
        </button>
      </form>
    </div>
  );
}
