import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Brand } from "../components/lp/Brand";
import { ControlRoom } from "../components/lp/ControlRoom";
import { useAuth } from "../lib/auth";
import { ACTIVE_PROJECT_KEY, API_URL } from "../lib/config";
import { createProject, listProjects, type LPProject } from "../lib/api";

export const Route = createFileRoute("/dashboard")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Control room — LivePulse" },
      {
        name: "description",
        content:
          "The LivePulse control room: live visitor sessions, event stream, error clusters and founder-to-visitor chat for your project.",
      },
      { property: "og:title", content: "Control room — LivePulse" },
      {
        property: "og:description",
        content: "Live sessions, live errors, live chat — all from your own collector.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: DashboardPage,
});

export function DashboardPage() {
  const { user, loading, signOut, configured } = useAuth();
  const navigate = useNavigate();

  const [projects, setProjects] = useState<LPProject[] | null>(null);
  const [projectsError, setProjectsError] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [creatingNew, setCreatingNew] = useState(false);

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/login", replace: true });
  }, [loading, user, navigate]);

  const load = useCallback(async () => {
    if (!user) return;
    setProjectsError(null);
    try {
      const list = await listProjects();
      setProjects(list);
      const stored =
        typeof window !== "undefined" ? window.localStorage.getItem(ACTIVE_PROJECT_KEY) : null;
      const next = list.find((p) => p._id === stored)?._id ?? list[0]?._id ?? null;
      setActiveId(next);
    } catch (err) {
      setProjects([]);
      setProjectsError(err instanceof Error ? err.message : "Couldn't load your projects.");
    }
  }, [user]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (activeId && typeof window !== "undefined")
      window.localStorage.setItem(ACTIVE_PROJECT_KEY, activeId);
  }, [activeId]);

  if (loading || !user) {
    return (
      <div className="lp-app">
        <div className="lp-grain" />
        <div className="lp-center">
          <div className="lp-card" aria-busy="true">
            <span className="lp-num">establishing signal</span>
            <div className="lp-skel" style={{ width: "70%" }} />
            <div className="lp-skel" style={{ width: "45%" }} />
          </div>
        </div>
      </div>
    );
  }

  const active = projects?.find((p) => p._id === activeId) ?? null;

  return (
    <div className="lp-app">
      <div className="lp-grain" />
      <header className="lp-topbar">
        <Brand />
        <div className="lp-topbar-right">
          {projects && projects.length > 1 && (
            <select
              className="lp-select"
              aria-label="Active project"
              value={activeId ?? ""}
              onChange={(e) => setActiveId(e.target.value)}
            >
              {projects.map((p) => (
                <option key={p._id} value={p._id}>
                  {p.name}
                </option>
              ))}
            </select>
          )}
          {projects && projects.length > 0 && (
            <button
              type="button"
              className="lp-btn lp-btn-ghost small"
              onClick={() => setCreatingNew((v) => !v)}
            >
              {creatingNew ? "cancel" : "+ new project"}
            </button>
          )}
          <span className="lp-chip" title={user.email ?? ""}>
            <i /> {user.email}
          </span>
          <button
            type="button"
            className="lp-btn lp-btn-ghost small"
            onClick={async () => {
              await signOut();
              navigate({ to: "/login", replace: true });
            }}
          >
            sign out
          </button>
        </div>
      </header>

      {creatingNew && projects && projects.length > 0 && (
        <div style={{ padding: "0 var(--gutter) 16px" }}>
          <FirstProject
            compact
            onCreated={(p) => {
              setProjects((prev) => [p, ...(prev ?? [])]);
              setActiveId(p._id);
              setCreatingNew(false);
            }}
          />
        </div>
      )}

      {!configured && (
        <div style={{ padding: "16px var(--gutter)" }}>
          <div className="lp-alert warn">
            <b>Auth isn't wired up yet</b>
            Set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code>, then reload.
          </div>
        </div>
      )}

      {projects === null ? (
        <div className="lp-center">
          <div className="lp-card" aria-busy="true">
            <span className="lp-num">loading projects</span>
            <div className="lp-skel" style={{ width: "60%" }} />
            <div className="lp-skel" style={{ width: "35%" }} />
          </div>
        </div>
      ) : projectsError ? (
        <div className="lp-center">
          <div className="lp-card">
            <span className="lp-num">collector unreachable</span>
            <h2>
              No signal from <em>the collector</em>.
            </h2>
            <div className="lp-alert" role="alert">
              <b>{projectsError}</b>
              Expecting the LivePulse backend at <code>{API_URL}</code>.
            </div>
            <button className="lp-btn" type="button" onClick={() => void load()}>
              retry connection <span style={{ color: "var(--pulse)" }}>→</span>
            </button>
          </div>
        </div>
      ) : projects.length === 0 ? (
        <FirstProject
          onCreated={(p) => {
            setProjects([p]);
            setActiveId(p._id);
          }}
        />
      ) : (
        <ControlRoomPlaceholder project={active} />
      )}
    </div>
  );
}

function FirstProject({
  onCreated,
  compact,
}: {
  onCreated: (p: LPProject) => void;
  compact?: boolean;
}) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const project = await createProject(name.trim());
      onCreated(project);
      setName("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create the project.");
    } finally {
      setBusy(false);
    }
  }

  const form = (
    <form className="lp-card" onSubmit={submit}>
      {!compact && (
        <>
          <span className="lp-num">02 / first project</span>
          <h2>
            Name the thing you want a <em>pulse</em> on.
          </h2>
          <p>
            A project is one product or site. Creating it issues an API key you'll paste into a
            single script tag — that's the whole install.
          </p>
        </>
      )}
      <div className="lp-field">
        <label className="lp-label" htmlFor="pname">
          project name
        </label>
        <input
          id="pname"
          ref={inputRef}
          className="lp-input"
          required
          maxLength={60}
          placeholder="Acme — marketing site"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      {error && (
        <div className="lp-alert" role="alert">
          <b>Couldn't create the project</b>
          {error}
        </div>
      )}
      <button className="lp-btn" type="submit" disabled={busy || !name.trim()}>
        {busy ? "provisioning…" : "create project"} <span style={{ color: "var(--pulse)" }}>→</span>
      </button>
    </form>
  );

  return compact ? form : <div className="lp-center">{form}</div>;
}

function ControlRoomPlaceholder({ project }: { project: LPProject | null }) {
  if (!project) return null;
  return <ControlRoom project={project} />;
}
