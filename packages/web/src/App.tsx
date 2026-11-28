import type { AuthStatus } from "@vibe-code/shared";
import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { api, setApiKey } from "./api/client";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { LoginScreen } from "./features/auth/LoginScreen";

const RemoteWorkspace = lazy(() => import("./features/remote-workspace/RemoteWorkspace"));

export default function App() {
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);

  const loadAuth = useCallback(() => {
    setAuthLoading(true);
    setAuthError(null);
    api.auth
      .me()
      .then(setAuth)
      .catch((err) => setAuthError(err instanceof Error ? err.message : String(err)))
      .finally(() => setAuthLoading(false));
  }, []);

  useEffect(() => {
    loadAuth();
  }, [loadAuth]);

  if (authLoading || !auth?.authenticated) {
    return <LoginScreen status={auth} loading={authLoading} error={authError} onRetry={loadAuth} />;
  }

  return (
    <ErrorBoundary>
      <Suspense
        fallback={
          <div role="status" className="p-6">
            Abrindo workspace…
          </div>
        }
      >
        <RemoteWorkspace
          onLogout={async () => {
            await api.auth.logout();
            setApiKey(null);
            loadAuth();
          }}
        />
      </Suspense>
    </ErrorBoundary>
  );
}
