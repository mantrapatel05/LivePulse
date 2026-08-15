import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { Brand } from "../components/lp/Brand";
import { useAuth } from "../lib/auth";

export const Route = createFileRoute("/login")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Sign in — LivePulse control room" },
      {
        name: "description",
        content:
          "Sign in to the LivePulse control room to watch live visitors, error bursts and chat with people using your product right now.",
      },
      { property: "og:title", content: "Sign in — LivePulse control room" },
      {
        property: "og:description",
        content: "Live visitors, live errors, live chat. Open the monitor room.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: LoginPage,
});

type Mode = "signin" | "signup";

function LoginPage() {
  const { signIn, signUp, signInWithGoogle, user, loading, configured } = useAuth();
  const navigate = useNavigate();
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function onGoogleClick() {
    setError(null);
    setGoogleBusy(true);
    try {
      await signInWithGoogle();
      // On success the browser navigates away to Google; if we're still
      // here, something failed before the redirect could happen.
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't start Google sign-in.");
      setGoogleBusy(false);
    }
  }

  useEffect(() => {
    if (!loading && user) navigate({ to: "/dashboard", replace: true });
  }, [loading, user, navigate]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      if (mode === "signin") {
        await signIn(email.trim(), password);
        await router.invalidate();
        navigate({ to: "/dashboard", replace: true });
      } else {
        const { needsConfirmation } = await signUp(email.trim(), password);
        if (needsConfirmation) {
          setNotice(
            "Account created. Confirm your email, then sign in. (For local dev you can switch off email confirmation in Supabase → Authentication → Providers.)",
          );
          setMode("signin");
        } else {
          navigate({ to: "/dashboard", replace: true });
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="lp-app">
      <div className="lp-grain" />
      <div className="lp-auth">
        <section className="lp-auth-panel">
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 12,
            }}
          >
            <Brand />
            <span className="lp-chip">
              <i /> collector online
            </span>
          </div>

          <span className="lp-kicker">
            {mode === "signin" ? "01 / authenticate" : "01 / new operator"}
          </span>

          <div>
            <h1>
              {mode === "signin" ? (
                <>
                  Back to the <em>monitor</em> room.
                </>
              ) : (
                <>
                  Put a <em>heartbeat</em> on your product.
                </>
              )}
            </h1>
            <p className="lp-auth-sub" style={{ marginTop: 16 }}>
              {mode === "signin"
                ? "Sign in to watch live sessions, catch errors as they fire, and talk to the person on the page."
                : "Create an operator account, spin up your first project, drop one script tag."}
            </p>
          </div>

          {!configured && (
            <div className="lp-alert warn">
              <b>Auth isn't wired up yet</b>
              Set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> in your
              environment, then reload this page.
            </div>
          )}

          <form className="lp-form" onSubmit={onSubmit}>
            <div className="lp-field">
              <label className="lp-label" htmlFor="email">
                email
              </label>
              <input
                id="email"
                className="lp-input"
                type="email"
                autoComplete="email"
                required
                placeholder="founder@yourproduct.dev"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            <div className="lp-field">
              <label className="lp-label" htmlFor="password">
                password
              </label>
              <input
                id="password"
                className="lp-input"
                type="password"
                autoComplete={mode === "signin" ? "current-password" : "new-password"}
                required
                minLength={6}
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>

            {error && (
              <div className="lp-alert" role="alert">
                <b>Couldn't {mode === "signin" ? "sign in" : "sign up"}</b>
                {error}
              </div>
            )}
            {notice && (
              <div className="lp-alert ok" role="status">
                <b>Check your inbox</b>
                {notice}
              </div>
            )}

            <button className="lp-btn block" type="submit" disabled={busy || !configured}>
              {busy ? "connecting…" : mode === "signin" ? "open dashboard" : "create account"}
              <span style={{ color: "var(--pulse)" }}>→</span>
            </button>
          </form>

          <div className="lp-divider" role="separator" aria-label="or">
            <span>or</span>
          </div>

          <button
            type="button"
            className="lp-btn block lp-btn-ghost"
            disabled={googleBusy || !configured}
            onClick={onGoogleClick}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 18 18"
              aria-hidden="true"
              style={{ marginRight: 8 }}
            >
              <path
                fill="#4285F4"
                d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.9c1.7-1.57 2.7-3.88 2.7-6.62z"
              />
              <path
                fill="#34A853"
                d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.9-2.26c-.8.54-1.84.86-3.06.86-2.35 0-4.34-1.59-5.05-3.72H.9v2.33A9 9 0 0 0 9 18z"
              />
              <path
                fill="#FBBC05"
                d="M3.95 10.7A5.4 5.4 0 0 1 3.66 9c0-.59.1-1.17.29-1.7V4.97H.9A9 9 0 0 0 0 9c0 1.45.35 2.83.9 4.03l3.05-2.33z"
              />
              <path
                fill="#EA4335"
                d="M9 3.58c1.32 0 2.5.46 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .9 4.97l3.05 2.33C4.66 5.17 6.65 3.58 9 3.58z"
              />
            </svg>
            {googleBusy ? "redirecting…" : "continue with Google"}
          </button>

          <div className="lp-switch-row">
            <span>
              {mode === "signin" ? "No operator account yet?" : "Already have an account?"}
            </span>
            <button
              type="button"
              className="lp-btn-link"
              onClick={() => {
                setMode(mode === "signin" ? "signup" : "signin");
                setError(null);
                setNotice(null);
              }}
            >
              {mode === "signin" ? "create one →" : "sign in instead →"}
            </button>
          </div>
        </section>

        <aside className="lp-auth-aside">
          <div className="lp-aside-title">
            What you see <em>the second</em> you're in.
          </div>
          <div className="lp-scope">
            <div className="lp-scope-head">
              <span className="lp-led" style={{ background: "#ff5f56" }} />
              <span className="lp-led" style={{ background: "#ffbd2e" }} />
              <span className="lp-led" style={{ background: "#27c93f" }} />
              <span style={{ marginLeft: 6 }}>stream — project feed</span>
              <span style={{ marginLeft: "auto", color: "var(--pulse)" }} className="lp-blink">
                ● rec
              </span>
            </div>
            <div className="lp-scope-row">
              <span className="t">00:00:01</span>
              <span className="lp-k view">view</span>
              <span>/pricing</span>
            </div>
            <div className="lp-scope-row">
              <span className="t">00:00:04</span>
              <span className="lp-k click">click</span>
              <span>button#checkout</span>
            </div>
            <div className="lp-scope-row">
              <span className="t">00:00:06</span>
              <span className="lp-k err">err</span>
              <span>TypeError: undefined is not a function</span>
            </div>
            <div className="lp-scope-row">
              <span className="t">00:00:09</span>
              <span className="lp-k chat">chat</span>
              <span>"hey — need a hand with checkout?"</span>
            </div>
          </div>
          <p className="lp-aside-note">
            <b>Every panel behind this door is real data.</b> Sessions, cities, error clusters and
            chat come straight off your collector — nothing on the dashboard is simulated.
          </p>
        </aside>
      </div>
    </div>
  );
}
