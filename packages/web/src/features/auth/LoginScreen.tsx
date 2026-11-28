import type { AuthStatus } from "@vibe-code/shared";
import { useState } from "react";
import { api, getApiKey, setApiKey } from "../../api/client";
import { Icon } from "../remote-workspace/Icon";
import "../remote-workspace/workspace.css";
import "./login.css";

const LOGIN_ERRORS: Record<string, string> = {
  invalid_state: "O login com GitHub expirou ou foi interrompido. Tente de novo.",
  not_allowed:
    "Este e-mail não está na lista de acesso deste servidor. Peça para incluírem em VIBE_CODE_ALLOWED_EMAILS.",
  github_failed: "O GitHub recusou o login. Confira o OAuth app e tente de novo.",
  google_failed: "O Google recusou o login. Confira o cliente OAuth e tente de novo.",
  google_not_allowed:
    "Este e-mail não está na lista de acesso deste servidor. Peça para incluírem em VIBE_CODE_ALLOWED_EMAILS.",
  identity_taken:
    "Esta conta já está vinculada a outro usuário. Entre com ela diretamente em vez de vincular.",
};

/** Error code the OAuth callback left in the URL; removed so a reload does not repeat it. */
function takeLoginError(): string | null {
  const url = new URL(window.location.href);
  const linkError = url.searchParams.get("link_error");
  const code = url.searchParams.get("auth_error") ?? linkError;
  if (!code) return null;
  url.searchParams.delete("auth_error");
  url.searchParams.delete("link_error");
  url.searchParams.delete("linked");
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

function GoogleMark() {
  return (
    <svg viewBox="0 0 18 18" width="17" height="17" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.33-1.58-5.04-3.7H.96v2.33A9 9 0 0 0 9 18Z"
      />
      <path
        fill="#FBBC05"
        d="M3.96 10.72A5.41 5.41 0 0 1 3.68 9c0-.6.1-1.18.28-1.72V4.95H.96A9 9 0 0 0 0 9c0 1.45.35 2.83.96 4.05l3-2.33Z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58A9 9 0 0 0 .96 4.95l3 2.33C4.67 5.16 6.66 3.58 9 3.58Z"
      />
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
  const google = status?.methods?.google ?? false;
  const oauth = github || google;
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

        {google && (
          <button
            type="button"
            className="rw-login-github rw-login-google"
            disabled={loading}
            onClick={() => {
              window.location.href = api.auth.googleLoginUrl();
            }}
          >
            <GoogleMark />
            {loading ? "Verificando…" : "Entrar com Google"}
          </button>
        )}

        {oauth && keyLogin && (
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
                className={oauth ? "rw-login-secondary" : "rw-login-primary"}
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
