import { io, type Socket } from "socket.io-client";
import { API_URL } from "./config";
import { getAccessToken } from "./api";

let dashboardSocket: Socket | null = null;

/**
 * One shared dashboard socket for the whole app. Authenticates with the
 * founder's Supabase session (not an api key — that's the SDK's job, on a
 * completely separate visitor connection with its own room).
 */
export function getDashboardSocket(): Socket {
  if (dashboardSocket) return dashboardSocket;

  const s = io(API_URL, {
    transports: ["websocket", "polling"],
    autoConnect: false,
    reconnectionDelay: 1500,
    reconnectionDelayMax: 8000,
  });

  // socket.io-client supports a function for `auth`, re-evaluated on every
  // (re)connect attempt — this is what keeps a long-lived dashboard tab
  // authenticated across token refreshes instead of freezing the token at
  // first connect.
  s.auth = async (cb) => {
    try {
      const token = await getAccessToken();
      cb({ token });
    } catch {
      cb({});
    }
  };

  s.connect();
  dashboardSocket = s;
  return s;
}

export function closeDashboardSocket() {
  if (!dashboardSocket) return;
  dashboardSocket.removeAllListeners();
  dashboardSocket.disconnect();
  dashboardSocket = null;
}

export type LiveEvent = {
  id: string;
  at: number;
  kind: "view" | "click" | "err" | "chat" | "session" | "other";
  name: string;
  label: string;
  sessionId?: string;
};

let seq = 0;

/** Turns any collector payload into one row the stream can render. */
export function normaliseEvent(name: string, payload: unknown): LiveEvent {
  const p = (payload ?? {}) as Record<string, unknown>;
  const n = name.toLowerCase();
  const type = String(p.type ?? p.eventType ?? p.event ?? "").toLowerCase();
  const kind: LiveEvent["kind"] = /error|err|exception/.test(n + type)
    ? "err"
    : /chat|message|founder_message|user_reply/.test(n + type)
      ? "chat"
      : /click|hover|interact/.test(n + type)
        ? "click"
        : /view|pageview|page/.test(n + type)
          ? "view"
          : /session|visitor|presence/.test(n)
            ? "session"
            : "other";

  const label =
    p.message ??
    p.text ??
    p.path ??
    p.url ??
    p.page ??
    p.name ??
    (typeof payload === "string" ? payload : type || name);

  return {
    id: `${Date.now()}-${seq++}`,
    at: Number(p.timestamp ?? p.at ?? Date.now()),
    kind,
    name,
    label: String(label).slice(0, 160),
    sessionId: [p.sessionId, p.session_id, p.sid].find((v) => typeof v === "string") as
      string | undefined,
  };
}
