/**
 * Runtime config for the LivePulse frontend shell.
 *
 * The backend (Express + Socket.io + MongoDB) is a separate repo/process.
 * Dashboard-privileged routes (projects, analytics, sessions, chat) require
 * a verified Supabase session (Authorization: Bearer <access_token>) — see
 * src/lib/api.ts. The public ingestion api key is a completely separate,
 * write-only credential used only by the embedded SDK.
 */

const env = import.meta.env as Record<string, string | undefined>;

export const API_URL = (env.VITE_API_URL ?? "http://localhost:5000").replace(/\/$/, "");

/** Publishable values — safe in the client bundle. Env vars win when set. */
export const SUPABASE_URL = env.VITE_SUPABASE_URL ?? "https://bnhgqrfstemtcnsbiwdx.supabase.co";
export const SUPABASE_ANON_KEY =
  env.VITE_SUPABASE_ANON_KEY ?? "sb_publishable__yF4AWbEZBn2IKaObyyzHQ_7IvvF8jv";

export const isSupabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

/** localStorage key holding the currently selected LivePulse project id. */
export const ACTIVE_PROJECT_KEY = "livepulse.activeProjectId";
