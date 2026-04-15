import type { SettingsResponse } from "@vibe-code/shared";
import { useCallback, useEffect, useId, useState } from "react";
import { api } from "../api/client";
import { useTheme } from "../theme/ThemeProvider";
import { themes } from "../theme/themes";
import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";
import { Input } from "./ui/input";

interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
}

type Tab = "github" | "gitlab" | "litellm" | "apikeys" | "general";

function ProviderTab({
  provider,
  label,
  tokenPlaceholder,
  showBaseUrl,
}: {
  provider: "github" | "gitlab";
  label: string;
  tokenPlaceholder: string;
  showBaseUrl?: boolean;
}) {
  const tokenInputId = useId();
  const baseUrlInputId = useId();
  const [token, setToken] = useState("");
  const [baseUrl, setBaseUrl] = useState("https://gitlab.com");
  const [tokenSet, setTokenSet] = useState(false);
  const [username, setUsername] = useState<string | undefined>();
  const [showToken, setShowToken] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    username?: string;
    error?: string;
  } | null>(null);

  useEffect(() => {
    setToken("");
    setShowToken(false);
    setSaved(false);
    setError(null);
    setTestResult(null);
    api.settings
      .get()
      .then((s: SettingsResponse) => {
        const p = s[provider];
        if (p) {
          setTokenSet(p.tokenSet);
          setUsername(p.username);
          if (showBaseUrl && p.baseUrl) setBaseUrl(p.baseUrl);
        }
      })
      .catch(console.error);
  }, [provider, showBaseUrl]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const data: any = {};
      if (provider === "github") data.githubToken = token;
      else {
        data.gitlabToken = token;
        if (showBaseUrl) data.gitlabBaseUrl = baseUrl;
      }
      await api.settings.update(data);
      setTokenSet(!!token);
      setToken("");
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleClear = async () => {
    setSaving(true);
    setError(null);
    try {
      const data: any = {};
      if (provider === "github") data.githubToken = "";
      else data.gitlabToken = "";
      await api.settings.update(data);
      setTokenSet(false);
      setUsername(undefined);
      setToken("");
      setTestResult(null);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await api.settings.testConnection(provider);
      setTestResult(result);
      if (result.ok && result.username) setUsername(result.username);
    } catch (err: any) {
      setTestResult({ ok: false, error: err.message });
    } finally {
      setTesting(false);
    }
  };

  return (
    <form onSubmit={handleSave} className="space-y-4">
      {/* Connection status */}
      <div
        className="flex items-center gap-3 px-3 py-2.5 rounded-lg"
        style={{ background: "var(--bg-card)" }}
      >
        <span className={`w-2 h-2 rounded-full ${tokenSet ? "bg-emerald-400" : "bg-zinc-600"}`} />
        <div className="flex-1">
          <span className="text-sm" style={{ color: "var(--text-primary)" }}>
            {tokenSet ? "Conectado" : "Não conectado"}
          </span>
          {username && (
            <span className="text-xs ml-2" style={{ color: "var(--text-muted)" }}>
              @{username}
            </span>
          )}
        </div>
        {tokenSet && (
          <Button type="button" variant="ghost" size="sm" onClick={handleTest} disabled={testing}>
            {testing ? "Testando..." : "Testar"}
          </Button>
        )}
      </div>

      {testResult && (
        <div
          className={`text-xs px-3 py-2 rounded-lg border ${
            testResult.ok
              ? "border-emerald-800/40 bg-emerald-950/30 text-emerald-400"
              : "border-red-800/40 bg-red-950/30 text-red-400"
          }`}
        >
          {testResult.ok ? `✓ Conectado como @${testResult.username}` : `✕ ${testResult.error}`}
        </div>
      )}

      {error && (
        <div className="text-xs px-3 py-2 rounded-lg border border-red-800/40 bg-red-950/30 text-red-400">
          {error}
        </div>
      )}

      {showBaseUrl && (
        <div>
          <label
            htmlFor={baseUrlInputId}
            className="block text-xs font-medium mb-1"
            style={{ color: "var(--text-muted)" }}
          >
            URL base
          </label>
          <Input
            id={baseUrlInputId}
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://gitlab.com"
          />
          <p className="text-xs mt-1" style={{ color: "var(--text-dimmed)" }}>
            GitLab self-hosted? Informe a URL da sua instância.
          </p>
        </div>
      )}

      {/* Token */}
      <div>
        <label
          htmlFor={tokenInputId}
          className="block text-xs font-medium mb-1"
          style={{ color: "var(--text-muted)" }}
        >
          {label} Token
        </label>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Input
              id={tokenInputId}
              type={showToken ? "text" : "password"}
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder={tokenSet ? "••••••••••••  (token salvo)" : tokenPlaceholder}
              autoComplete="off"
            />
            <button
              type="button"
              onClick={() => setShowToken((v) => !v)}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs cursor-pointer"
              style={{ color: "var(--text-dimmed)" }}
            >
              {showToken ? "ocultar" : "mostrar"}
            </button>
          </div>
          {tokenSet && (
            <Button type="button" variant="ghost" onClick={handleClear} disabled={saving}>
              Limpar
            </Button>
          )}
        </div>
        <p className="text-xs mt-1.5" style={{ color: "var(--text-dimmed)" }}>
          {provider === "github" ? (
            <>
              Usado para criar PR e consultar merge. Requer escopo{" "}
              <code style={{ color: "var(--text-muted)" }}>repo</code>.
            </>
          ) : (
            <>
              Usado para Merge Requests e listagem de projetos. Requer escopo{" "}
              <code style={{ color: "var(--text-muted)" }}>api</code>.
            </>
          )}
        </p>
      </div>

      <div className="flex items-center justify-between pt-1">
        <div className="text-xs h-4" style={{ color: "var(--success)" }}>
          {saved && "Salvo!"}
        </div>
        <Button type="submit" variant="primary" disabled={saving || !token.trim()}>
          {saving ? "Salvando..." : "Salvar"}
        </Button>
      </div>
    </form>
  );
}

function LiteLLMTab() {
  const proxyUrlInputId = useId();
  const [baseUrl, setBaseUrl] = useState("http://localhost:4000");
  const [enabled, setEnabled] = useState(true);
  const [health, setHealth] = useState<{ ok: boolean; baseUrl: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadHealth = useCallback(
    (url?: string) => {
      api.settings
        .litellmHealth()
        .then(setHealth)
        .catch(() => setHealth({ ok: false, baseUrl: url ?? baseUrl }));
    },
    [baseUrl]
  );

  useEffect(() => {
    setSaved(false);
    setError(null);
    api.settings
      .get()
      .then((settings) => {
        setBaseUrl(settings.litellm.baseUrl);
        setEnabled(settings.litellm.enabled);
        loadHealth(settings.litellm.baseUrl);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [loadHealth]);

  const handleToggle = async () => {
    const next = !enabled;
    setEnabled(next);
    try {
      await api.settings.update({ litellmEnabled: next });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setEnabled(!next);
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api.settings.update({ litellmBaseUrl: baseUrl });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      loadHealth(baseUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSave} className="space-y-4">
      {/* Enable/disable toggle */}
      <div
        className="flex items-center justify-between px-3 py-2.5 rounded-lg"
        style={{ background: "var(--bg-card)" }}
      >
        <div className="flex-1">
          <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
            Usar LiteLLM Proxy
          </span>
          <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
            {enabled
              ? "Todas as engines serão roteadas pelo LiteLLM."
              : "Engines usarão chaves nativas do ambiente (sem rastreio de tokens/custos)."}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          onClick={handleToggle}
          className="relative inline-flex h-6 w-11 items-center rounded-full transition-colors cursor-pointer"
          style={{ background: enabled ? "var(--accent)" : "var(--bg-input)" }}
        >
          <span
            className="inline-block h-4 w-4 rounded-full transition-transform bg-white"
            style={{ transform: enabled ? "translateX(1.375rem)" : "translateX(0.25rem)" }}
          />
        </button>
      </div>

      {!enabled && (
        <div className="text-xs px-3 py-2 rounded-lg border border-amber-800/40 bg-amber-950/30 text-amber-400">
          ⚠ Rastreamento de tokens, rate limiting e monitoramento de custos ficarão desabilitados.
        </div>
      )}

      {/* Health status */}
      <div
        className="flex items-center gap-3 px-3 py-2.5 rounded-lg"
        style={{ background: "var(--bg-card)", opacity: enabled ? 1 : 0.5 }}
      >
        <span
          className={`w-2 h-2 rounded-full ${
            health === null ? "bg-zinc-500" : health.ok ? "bg-emerald-400" : "bg-red-500"
          }`}
        />
        <div className="flex-1">
          <span className="text-sm" style={{ color: "var(--text-primary)" }}>
            {health === null ? "Verificando..." : health.ok ? "LiteLLM online" : "LiteLLM offline"}
          </span>
          <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
            Proxy para controle de tokens, custos e rate limiting dos CLIs de IA.
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => window.open(`${baseUrl}/ui`, "_blank")}
        >
          Abrir Dashboard
        </Button>
      </div>

      {error && (
        <div className="text-xs px-3 py-2 rounded-lg border border-red-800/40 bg-red-950/30 text-red-400">
          {error}
        </div>
      )}

      <div>
        <label
          htmlFor={proxyUrlInputId}
          className="block text-xs font-medium mb-1"
          style={{ color: "var(--text-muted)" }}
        >
          URL do Proxy
        </label>
        <Input
          id={proxyUrlInputId}
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          placeholder="http://localhost:4000"
          autoComplete="off"
        />
        <p className="text-xs mt-1.5" style={{ color: "var(--text-dimmed)" }}>
          Endereço do LiteLLM Proxy. Defina também{" "}
          <code style={{ color: "var(--text-muted)" }}>LITELLM_BASE_URL</code> e{" "}
          <code style={{ color: "var(--text-muted)" }}>LITELLM_MASTER_KEY</code> no ambiente do
          servidor.
        </p>
      </div>

      <div className="flex items-center justify-between pt-1">
        <div className="text-xs h-4" style={{ color: "var(--success)" }}>
          {saved && "Salvo!"}
        </div>
        <Button type="submit" variant="primary" disabled={saving}>
          {saving ? "Salvando..." : "Salvar"}
        </Button>
      </div>
    </form>
  );
}

interface ApiKeyFieldProps {
  label: string;
  description: string;
  settingKey: "geminiApiKey" | "anthropicApiKey" | "openaiApiKey";
  placeholder: string;
  tokenSet: boolean;
  onSaved: () => void;
}

function ApiKeyField({
  label,
  description,
  settingKey,
  placeholder,
  tokenSet: initialSet,
  onSaved,
}: ApiKeyFieldProps) {
  const [value, setValue] = useState("");
  const [tokenSet, setTokenSet] = useState(initialSet);
  const [showVal, setShowVal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api.settings.update({ [settingKey]: value });
      setTokenSet(!!value);
      setValue("");
      setSaved(true);
      onSaved();
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleClear = async () => {
    setSaving(true);
    setError(null);
    try {
      await api.settings.update({ [settingKey]: "" });
      setTokenSet(false);
      setValue("");
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSave} className="space-y-2">
      <div className="flex items-center gap-2">
        <span
          className={`w-2 h-2 rounded-full shrink-0 ${tokenSet ? "bg-emerald-400" : "bg-zinc-600"}`}
        />
        <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
          {label}
        </span>
        <span className="text-xs" style={{ color: "var(--text-muted)" }}>
          {tokenSet ? "configurada" : "não configurada"}
        </span>
      </div>
      <p className="text-xs pl-4" style={{ color: "var(--text-dimmed)" }}>
        {description}
      </p>
      {error && (
        <div className="text-xs px-3 py-1.5 rounded border border-red-800/40 bg-red-950/30 text-red-400">
          {error}
        </div>
      )}
      <div className="flex gap-2 pl-4">
        <div className="relative flex-1">
          <Input
            type={showVal ? "text" : "password"}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={tokenSet ? "•••••••••• (chave salva)" : placeholder}
            autoComplete="off"
          />
          <button
            type="button"
            onClick={() => setShowVal((v) => !v)}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs cursor-pointer"
            style={{ color: "var(--text-dimmed)" }}
          >
            {showVal ? "ocultar" : "mostrar"}
          </button>
        </div>
        {tokenSet && (
          <Button type="button" variant="ghost" onClick={handleClear} disabled={saving}>
            Limpar
          </Button>
        )}
        <Button type="submit" variant="primary" disabled={saving || !value.trim()}>
          {saving ? "…" : saved ? "Salvo!" : "Salvar"}
        </Button>
      </div>
    </form>
  );
}

function ApiKeysTab() {
  const [keys, setKeys] = useState<{
    gemini: boolean;
    anthropic: boolean;
    openai: boolean;
  }>({ gemini: false, anthropic: false, openai: false });

  const load = useCallback(() => {
    api.settings
      .get()
      .then((s: SettingsResponse) => {
        if (s.apiKeys) {
          setKeys({
            gemini: s.apiKeys.gemini.tokenSet,
            anthropic: s.apiKeys.anthropic.tokenSet,
            openai: s.apiKeys.openai.tokenSet,
          });
        }
      })
      .catch(console.error);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-5">
      <p className="text-xs" style={{ color: "var(--text-muted)" }}>
        Chaves de API nativas usadas quando o LiteLLM está desabilitado.
      </p>
      <ApiKeyField
        label="Gemini API Key"
        description="Usada pelo Gemini CLI. Obtenha em aistudio.google.com/apikey."
        settingKey="geminiApiKey"
        placeholder="AIzaSy..."
        tokenSet={keys.gemini}
        onSaved={load}
      />
      <ApiKeyField
        label="Anthropic API Key"
        description="Usada pelo Claude Code. Obtenha em console.anthropic.com."
        settingKey="anthropicApiKey"
        placeholder="sk-ant-..."
        tokenSet={keys.anthropic}
        onSaved={load}
      />
      <ApiKeyField
        label="OpenAI API Key"
        description="Usada pelo Aider e outros engines compatíveis com OpenAI."
        settingKey="openaiApiKey"
        placeholder="sk-..."
        tokenSet={keys.openai}
        onSaved={load}
      />
    </div>
  );
}

export function SettingsDialog({ open, onClose }: SettingsDialogProps) {
  const [tab, setTab] = useState<Tab>("github");
  const { themeName, setTheme } = useTheme();

  return (
    <Dialog open={open} onClose={onClose} title="Configurações">
      {/* Tabs */}
      <div className="flex gap-1 mb-5 rounded-lg p-1" style={{ background: "var(--bg-input)" }}>
        {(["github", "gitlab", "litellm", "apikeys", "general"] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`flex-1 text-xs font-medium py-2 rounded-md transition-colors cursor-pointer capitalize ${
              tab === t ? "shadow-sm" : ""
            }`}
            style={{
              background: tab === t ? "var(--bg-surface)" : "transparent",
              color: tab === t ? "var(--text-primary)" : "var(--text-muted)",
            }}
          >
            {t === "github"
              ? "GitHub"
              : t === "gitlab"
                ? "GitLab"
                : t === "litellm"
                  ? "LiteLLM"
                  : t === "apikeys"
                    ? "API Keys"
                    : "Geral"}
          </button>
        ))}
      </div>

      {tab === "github" && (
        <ProviderTab
          provider="github"
          label="GitHub"
          tokenPlaceholder="token_github_xxxxxxxxxxxx"
        />
      )}

      {tab === "gitlab" && (
        <ProviderTab
          provider="gitlab"
          label="GitLab"
          tokenPlaceholder="glpat-xxxxxxxxxxxx"
          showBaseUrl
        />
      )}

      {tab === "litellm" && <LiteLLMTab />}

      {tab === "apikeys" && <ApiKeysTab />}

      {tab === "general" && (
        <div className="space-y-5">
          {/* Theme selector */}
          <div>
            <div className="block text-xs font-medium mb-2" style={{ color: "var(--text-muted)" }}>
              Tema
            </div>
            <div className="grid grid-cols-3 gap-2">
              {Object.values(themes).map((t) => (
                <button
                  key={t.name}
                  type="button"
                  onClick={() => {
                    setTheme(t.name);
                    api.settings.update({ theme: t.name }).catch(() => {});
                  }}
                  className={`relative px-3 py-3 rounded-lg border text-xs font-medium cursor-pointer transition-all ${
                    themeName === t.name ? "ring-2 ring-offset-1" : ""
                  }`}
                  style={{
                    background: t.colors.bgApp,
                    borderColor: themeName === t.name ? t.colors.accent : t.colors.glassBorder,
                    color: t.colors.textPrimary,
                    // @ts-expect-error ring-color set via CSS variable
                    "--tw-ring-color": t.colors.accent,
                  }}
                >
                  <div className="flex items-center gap-2 mb-1.5">
                    <span
                      className="w-3 h-3 rounded-full"
                      style={{ background: t.colors.accent }}
                    />
                    <span>{t.label}</span>
                  </div>
                  <div className="flex gap-1">
                    <span className="w-4 h-2 rounded-sm" style={{ background: t.colors.success }} />
                    <span className="w-4 h-2 rounded-sm" style={{ background: t.colors.warning }} />
                    <span className="w-4 h-2 rounded-sm" style={{ background: t.colors.danger }} />
                    <span className="w-4 h-2 rounded-sm" style={{ background: t.colors.info }} />
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="pt-2 flex justify-end">
            <Button type="button" variant="ghost" onClick={onClose}>
              Fechar
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
