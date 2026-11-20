import type { AuthStatus } from "@vibe-code/shared";
import { useState } from "react";
import { api, getApiKey, setApiKey } from "../../api/client";
import { Icon } from "../remote-workspace/Icon";
import "../remote-workspace/workspace.css";
import "./login.css";

const LOGIN_ERRORS: Record<string, string> = {
  invalid_state: "O login com GitHub expirou ou foi interrompido. Tente de novo.",
  not_allowed: "Esta conta do GitHub não tem permissão neste servidor (GITHUB_ALLOWED_USERS).",
  github_failed: "O GitHub recusou o login. Confira o OAuth app e tente de novo.",
};

/** Error code the OAuth callback left in the URL; removed so a reload does not repeat it. */
function takeLoginError(): string | null {
  const url = new URL(window.location.href);
  const code = url.searchParams.get("auth_error");
  if (!code) return null;
  url.searchParams.delete("auth_error");
  window.history.replaceState(null, "", url);
  return LOGIN_ERRORS[code] ?? LOGIN_ERRORS.github_failed;
}

function GitHubMark() {
  return (
    <svg viewBox="0 0 16 16" width="17" height="17" aria-hidden="true" fill="currentColor">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}

export function LoginScreen({
  status,
  loading,
  error,
  onRetry,
}: {
  status: AuthStatus | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}) {
  const [accessKey, setAccessKey] = useState("");
  const [oauthError] = useState(takeLoginError);
  const github = status?.methods?.github ?? status?.enabled !== false;
  const keyLogin = status?.methods?.apiKey ?? status?.enabled !== false;
  // A stored key that the server still rejects is a wrong (or rotated) key.
  const keyRejected = !loading && !!status && !status.authenticated && !!getApiKey();

  return (
    <main className="rw-login">
      <section className="rw-login-card" aria-labelledby="rw-login-title">
        <p className="rw-login-brand">
          <Icon name="code" size={20} /> vibe <span>remote</span>
        </p>
        <h1 id="rw-login-title">Entre no seu workspace</h1>
        <p className="rw-login-lead">
          Seus agentes trabalham no servidor. Acompanhe, responda e abra o PR de qualquer aparelho.
        </p>
        {(error || oauthError) && (
          <p role="alert" className="rw-login-error">
            {oauthError ?? error}
          </p>
        )}

        {github && (
          <button
            type="button"
            className="rw-login-github"
            disabled={loading}
            onClick={() => {
              window.location.href = api.auth.loginUrl();
            }}
          >
            <GitHubMark />
            {loading ? "Verificando…" : "Entrar com GitHub"}
          </button>
        )}

        {github && keyLogin && (
          <p className="rw-login-divider">
            <span>ou use uma chave de API</span>
          </p>
        )}

        {keyLogin && (
          <form
            className="rw-login-key"
            onSubmit={(e) => {
              e.preventDefault();
              const value = accessKey.trim();
              if (!value) return;
              setApiKey(value);
              setAccessKey("");
              onRetry();
            }}
          >
            <label htmlFor="access-key">Chave de acesso</label>
            <div>
              <input
                id="access-key"
                type="password"
                value={accessKey}
                onChange={(e) => setAccessKey(e.target.value)}
                placeholder="Cole a chave de acesso"
                autoComplete="current-password"
                aria-invalid={keyRejected}
                aria-describedby="access-key-help"
              />
              <button
                type="submit"
                className={github ? "rw-login-secondary" : "rw-login-primary"}
                disabled={loading || accessKey.trim().length === 0}
              >
                Entrar
              </button>
            </div>
            {keyRejected ? (
              <p id="access-key-help" role="alert" className="rw-login-error">
                Chave inválida. Confira o valor de <code>VIBE_CODE_API_KEY</code> no servidor.
              </p>
            ) : (
              <p id="access-key-help" className="rw-login-help">
                O valor de <code>VIBE_CODE_API_KEY</code>. Fica salvo só neste aparelho.
              </p>
            )}
          </form>
        )}

        {error && (
          <button type="button" className="rw-login-retry" onClick={onRetry}>
            <Icon name="refresh" size={14} /> Tentar de novo
          </button>
        )}
        {status?.enabled === false && (
          <p className="rw-login-help">Autenticação não configurada no servidor.</p>
        )}
      </section>
    </main>
  );
}
