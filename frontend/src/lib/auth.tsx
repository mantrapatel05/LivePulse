import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { getSupabase } from "./supabaseClient";
import { isSupabaseConfigured } from "./config";

type AuthValue = {
  session: Session | null;
  user: User | null;
  loading: boolean;
  configured: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<{ needsConfirmation: boolean }>;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthValue | null>(null);

/** Maps raw Supabase auth errors to language a founder can act on. */
export function humanizeAuthError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("email not confirmed"))
    return "This email hasn't been confirmed yet. Check your inbox, or turn off email confirmation in your Supabase Auth providers for local dev.";
  if (m.includes("invalid login credentials"))
    return "That email and password combination doesn't match an account.";
  if (m.includes("user already registered"))
    return "An account already exists for this email. Sign in instead.";
  if (m.includes("password should be at least"))
    return "Password is too short — use at least 6 characters.";
  if (m.includes("rate limit") || m.includes("too many"))
    return "Too many attempts. Wait a moment and try again.";
  if (m.includes("failed to fetch"))
    return "Couldn't reach the auth service. Check your connection and Supabase URL.";
  return message;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const supabase = getSupabase();
    if (!supabase) {
      setLoading(false);
      return;
    }
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session ?? null);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next ?? null);
      setLoading(false);
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const value = useMemo<AuthValue>(
    () => ({
      session,
      user: session?.user ?? null,
      loading,
      configured: isSupabaseConfigured,
      async signIn(email, password) {
        const supabase = getSupabase();
        if (!supabase) throw new Error("Auth is not configured.");
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw new Error(humanizeAuthError(error.message));
      },
      async signUp(email, password) {
        const supabase = getSupabase();
        if (!supabase) throw new Error("Auth is not configured.");
        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) throw new Error(humanizeAuthError(error.message));
        return { needsConfirmation: !data.session };
      },
      async signInWithGoogle() {
        const supabase = getSupabase();
        if (!supabase) throw new Error("Auth is not configured.");
        const redirectTo =
          typeof window !== "undefined" ? `${window.location.origin}/auth/callback` : undefined;
        const { error } = await supabase.auth.signInWithOAuth({
          provider: "google",
          options: { redirectTo },
        });
        if (error) throw new Error(humanizeAuthError(error.message));
        // Browser redirects to Google now; nothing else to do here.
      },
      async signOut() {
        const supabase = getSupabase();
        if (!supabase) return;
        await supabase.auth.signOut();
      },
    }),
    [session, loading],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
