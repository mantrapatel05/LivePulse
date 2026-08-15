import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Link, Outlet, createRootRouteWithContext } from "@tanstack/react-router";
import { AuthProvider } from "../lib/auth";

function NotFoundComponent() {
  return (
    <div className="lp-app lp-center">
      <div className="lp-card">
        <span className="lp-num">404 / lost signal</span>
        <h2>
          That page is not on this <em>frequency</em>.
        </h2>
        <Link to="/" className="lp-btn">
          return home
        </Link>
      </div>
    </div>
  );
}

function ErrorComponent({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="lp-app lp-center">
      <div className="lp-card">
        <span className="lp-num">signal interrupted</span>
        <h2>
          This page could not <em>load</em>.
        </h2>
        <button type="button" className="lp-btn" onClick={reset}>
          try again
        </button>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <Outlet />
      </AuthProvider>
    </QueryClientProvider>
  );
}
