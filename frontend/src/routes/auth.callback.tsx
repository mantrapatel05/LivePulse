import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "../lib/auth";
import { Brand } from "../components/lp/Brand";

export const Route = createFileRoute("/auth/callback")({
  ssr: false,
  head: () => ({
    meta: [{ title: "Signing in — LivePulse" }],
  }),
  component: AuthCallback,
});

function AuthCallback() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    if (!loading && user) {
      navigate({ to: "/dashboard", replace: true });
    }
  }, [loading, user, navigate]);

  useEffect(() => {
    // Supabase's detectSessionInUrl parses the redirect asynchronously; if
    // it hasn't resolved after a few seconds something's actually wrong
    // (bad redirect URL, provider not enabled, etc.) rather than just slow.
    const t = setTimeout(() => setTimedOut(true), 6000);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="lp-app">
      <div className="lp-grain" />
      <div className="lp-center">
        <div className="lp-card" aria-busy={!timedOut}>
          <div style={{ marginBottom: 12 }}>
            <Brand />
          </div>
          {!timedOut ? (
            <>
              <span className="lp-num">completing sign-in</span>
              <div className="lp-skel" style={{ width: "70%" }} />
              <div className="lp-skel" style={{ width: "45%" }} />
            </>
          ) : (
            <>
              <span className="lp-num">still waiting</span>
              <h2>This is taking longer than it should.</h2>
              <div className="lp-alert warn" role="status">
                <b>Didn't finish signing in</b>
                Check that Google is enabled in Supabase → Authentication → Providers, and that this
                URL is listed under Redirect URLs.
              </div>
              <a className="lp-btn" href="/login">
                back to sign in <span style={{ color: "var(--pulse)" }}>→</span>
              </a>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
