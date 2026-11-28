import { useQuery } from "@tanstack/react-query";
import type { McpConnection } from "@vibe-code/shared";
import { useState } from "react";
import { api } from "../../api/client";
import { Button } from "../../ui/Button";

const LABELS: Record<McpConnection["id"], string> = {
  github: "GitHub",
  gitlab: "GitLab",
  playwright: "Playwright",
  context7: "Context7",
};
const PURPOSE: Partial<Record<McpConnection["id"], string>> = {
  playwright: "navegador para testar telas e tirar prints de evidência",
  context7: "documentação atualizada das bibliotecas",
};

export function useMcpConnections(enabled = true) {
  return useQuery({
    queryKey: ["mcp-connections"],
    queryFn: api.integrations.mcp,
    retry: false,
    enabled,
  });
}

/** Default MCPs that are on but still lack credentials: the app asks the user to sign in. */
export function pendingMcpAuth(connections: McpConnection[] | undefined): McpConnection[] {
  return (connections ?? []).filter((item) => item.enabled && !item.overridden && !item.connected);
}

export interface ConnectResult {
  ok: boolean;
  provider: string;
}

/** Outcome an OAuth connect left in the URL (`?connected=` / `?connect_error=`), read once. */
export function takeConnectResult(): ConnectResult | null {
  const url = new URL(window.location.href);
  const ok = url.searchParams.get("connected");
  const failed = url.searchParams.get("connect_error");
  if (!ok && !failed) return null;
  url.searchParams.delete("connected");
  url.searchParams.delete("connect_error");
  window.history.replaceState(null, "", url);
  return { ok: Boolean(ok), provider: (ok ?? failed ?? "").slice(0, 20) };
}

const DISMISS_KEY = "rw-mcp-notice-dismissed";

/** Asks for sign-in when a default MCP is on but has no credentials. */
export function McpAuthNotice({
  onOpen,
  providers,
}: {
  onOpen: () => void;
  /** Providers actually used by the workspace's repos (e.g. ["github"]). */
  providers?: string[];
}) {
  const query = useMcpConnections();
  const [dismissed, setDismissed] = useState(() => {
    try {
      return sessionStorage.getItem(DISMISS_KEY) === "1";
    } catch {
      return false;
    }
  });
  const pending = pendingMcpAuth(query.data).filter((item) => {
    if (!providers || providers.length === 0) return true;
    if (item.id === "github" || item.id === "gitlab") return providers.includes(item.id);
    return true;
  });
  if (dismissed || !pending.length) return null;
  return (
    <div className="rw-mcp-notice" role="note">
      <span>
        Autentique {pending.map((item) => LABELS[item.id]).join(" e ")} para os agentes usarem o MCP
        padrão.
      </span>
      <Button onClick={onOpen}>Autenticar</Button>
      <Button
        variant="subtle"
        aria-label="Dispensar aviso de MCP"
        onClick={() => {
          setDismissed(true);
          try {
            sessionStorage.setItem(DISMISS_KEY, "1");
          } catch {}
        }}
      >
        Agora não
      </Button>
    </div>
  );
}

function describe(item: McpConnection): string {
  if (item.overridden) return "Substituído pelo seu JSON de MCP abaixo.";
  if (item.authless) return `Sem autenticação · ${PURPOSE[item.id] ?? ""}`;
  if (!item.connected) return "Não autenticado · os agentes ficam sem este MCP.";
  const via = item.method === "oauth" ? "OAuth" : "token";
  return `Autenticado via ${via}${item.account ? ` · @${item.account}` : ""}${item.baseUrl ? ` · ${item.baseUrl}` : ""}`;
}

/** Settings → MCP: the default MCPs every run gets, and the GitHub/GitLab sign-in. */
export function McpConnections({ connectResult }: { connectResult?: ConnectResult | null }) {
  const query = useMcpConnections();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(() => {
    if (!connectResult) return null;
    const name = LABELS[connectResult.provider as McpConnection["id"]] ?? connectResult.provider;
    return connectResult.ok
      ? { ok: true, text: `${name} autenticado. O MCP entra no próximo turno.` }
      : { ok: false, text: `Não foi possível autenticar no ${name}. Tente de novo.` };
  });
  const [token, setToken] = useState("");
  const [baseUrl, setBaseUrl] = useState<string | null>(null);
  const [app, setApp] = useState({ clientId: "", clientSecret: "" });
  const [showApp, setShowApp] = useState(false);
  const gitlab = query.data?.find((item) => item.id === "gitlab");
  const gitlabUrl = baseUrl ?? gitlab?.baseUrl ?? "https://gitlab.com";

  const run = async (work: () => Promise<string | undefined>) => {
    setBusy(true);
    setMessage(null);
    try {
      const text = await work();
      await query.refetch();
      if (text) setMessage({ ok: true, text });
    } catch (err) {
      setMessage({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };
  const connect = (id: McpConnection["id"]) =>
    run(async () => {
      const { url } = await api.integrations.connect(id);
      window.location.assign(url);
      return undefined;
    });

  return (
    <section className="rw-settings-card" aria-labelledby="mcp-defaults-title">
      <div className="rw-card-heading">
        <h2 id="mcp-defaults-title">MCPs padrão</h2>
        <p>
          Entram em toda sessão. GitHub e GitLab depois que você autentica: GitLab aceita token
          (inclusive on-prem) ou OAuth2 quando a instância tem um aplicativo configurado.
        </p>
      </div>
      {message && (
        <p
          role={message.ok ? "status" : "alert"}
          className={message.ok ? "rw-success" : "rw-alert"}
        >
          {message.text}
        </p>
      )}
      {query.data?.map((item) => (
        <div key={item.id} className="rw-plugin-row" data-mcp={item.id}>
          <span className={`rw-status-dot ${item.connected ? "waiting" : "failed"}`} />
          <div>
            <strong>{LABELS[item.id]} MCP</strong>
            <small>{describe(item)}</small>
          </div>
          <span className="rw-pr-actions">
            {item.id === "github" && item.oauthAvailable && (
              <Button
                variant={item.connected ? "default" : "primary"}
                disabled={busy}
                onClick={() => connect("github")}
              >
                {item.connected ? "Reconectar GitHub" : "Autenticar com GitHub"}
              </Button>
            )}
            {item.id === "gitlab" && item.oauthAvailable && (
              <Button
                variant={item.connected ? "default" : "primary"}
                disabled={busy}
                onClick={() => connect("gitlab")}
              >
                Entrar com GitLab (OAuth2)
              </Button>
            )}
            {item.connected && !item.authless && (
              <Button
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    await api.integrations.disconnect(item.id);
                    return `${LABELS[item.id]} desconectado.`;
                  })
                }
              >
                Desconectar
              </Button>
            )}
            <label className="rw-setting-toggle">
              <span className="rw-sr-only">Usar {LABELS[item.id]} MCP</span>
              <input
                type="checkbox"
                aria-label={`Usar ${LABELS[item.id]} MCP`}
                checked={item.enabled}
                disabled={busy}
                onChange={(event) =>
                  run(async () => {
                    await api.integrations.setEnabled(item.id, event.target.checked);
                    return undefined;
                  })
                }
              />
            </label>
          </span>
        </div>
      ))}
      <form
        className="rw-settings-form"
        aria-label="Token do GitLab"
        onSubmit={(event) => {
          event.preventDefault();
          void run(async () => {
            const result = await api.integrations.saveGitLabToken(token.trim(), gitlabUrl.trim());
            setToken("");
            const account = result.find((item) => item.id === "gitlab")?.account;
            return `GitLab autenticado${account ? ` como @${account}` : ""}.`;
          });
        }}
      >
        <label>
          URL do GitLab (on-prem ou gitlab.com)
          <input
            type="url"
            required
            value={gitlabUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
          />
        </label>
        <label>
          Personal access token (escopo api)
          <input
            type="password"
            autoComplete="new-password"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            placeholder={gitlab?.connected ? "Configurado · cole para substituir" : "glpat-…"}
          />
        </label>
        <span className="rw-pr-actions">
          <Button
            type="submit"
            variant="primary"
            loading={busy}
            disabled={busy || token.trim().length < 8}
          >
            Salvar token do GitLab
          </Button>
          <Button onClick={() => setShowApp(!showApp)}>
            {showApp ? "Ocultar OAuth2" : "Configurar OAuth2 do GitLab"}
          </Button>
        </span>
      </form>
      {showApp && (
        <form
          className="rw-settings-form"
          aria-label="Aplicativo OAuth do GitLab"
          onSubmit={(event) => {
            event.preventDefault();
            void run(async () => {
              await api.integrations.saveGitLabApp({
                clientId: app.clientId.trim(),
                clientSecret: app.clientSecret.trim() || undefined,
                baseUrl: gitlabUrl.trim(),
              });
              setApp({ clientId: "", clientSecret: "" });
              return "Aplicativo OAuth salvo. Use “Entrar com GitLab”.";
            });
          }}
        >
          <p className="rw-section-note">
            No GitLab: Preferências → Aplicações, escopos <code>api read_user</code>, callback{" "}
            <code>{`${window.location.origin}/api/auth/gitlab/callback`}</code>.
          </p>
          <label>
            Application ID
            <input
              required
              value={app.clientId}
              onChange={(event) => setApp({ ...app, clientId: event.target.value })}
            />
          </label>
          <label>
            Secret
            <input
              type="password"
              autoComplete="new-password"
              value={app.clientSecret}
              onChange={(event) => setApp({ ...app, clientSecret: event.target.value })}
            />
          </label>
          <Button type="submit" variant="primary" loading={busy} disabled={busy || !app.clientId}>
            Salvar aplicativo OAuth
          </Button>
        </form>
      )}
    </section>
  );
}
