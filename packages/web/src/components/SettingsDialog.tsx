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

type Tab = "github" | "gitlab" | "litellm" | "apikeys" | "general" | "telegram" | "mcp";

function SettingsSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
      <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-accent ml-1">
        {title}
      </h3>
      <div className="space-y-4">{children}</div>
    </div>
  );
}

function GitHubOAuthTab() {
  const [status, setStatus] = useState<SettingsResponse | null>(null);
  const [auth, setAuth] = useState<{
    username?: string;
    enabled: boolean;
    avatarUrl?: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    Promise.all([api.settings.get(), api.auth.me()])
      .then(([settings, authStatus]) => {
        setStatus(settings);
        setAuth({
          username: authStatus.user?.username ?? settings.github.username,
          enabled: authStatus.enabled,
          avatarUrl: authStatus.user?.avatarUrl,
        });
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <SettingsSection title="Identity Provider">
      <div className="flex items-center gap-5 p-6 rounded-[2rem] bg-white/[0.02] border border-white/5 shadow-inner">
        {auth?.avatarUrl ? (
          <img
            src={auth.avatarUrl}
            alt={auth.username}
            className="w-16 h-16 rounded-[1.5rem] shadow-2xl ring-4 ring-accent/10"
          />
        ) : (
          <div className="w-16 h-16 rounded-[1.5rem] bg-accent flex items-center justify-center text-2xl text-white font-black shadow-2xl shadow-accent/20">
            {auth?.username?.[0].toUpperCase() || "?"}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <p className="text-lg font-black tracking-tight text-primary leading-none">
            {status?.github.tokenSet ? `@${auth?.username}` : "Not Connected"}
          </p>
          <div className="flex items-center gap-2 mt-2">
            <span
              className={`w-2 h-2 rounded-full ${status?.github.tokenSet ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" : "bg-zinc-600"}`}
            />
            <span className="text-[10px] font-black uppercase tracking-widest text-muted">
              {status?.github.tokenSet ? "GitHub OAuth Active" : "Authentication Required"}
            </span>
          </div>
        </div>
        <Button
          type="button"
          variant="primary"
          disabled={auth?.enabled === false}
          onClick={() => {
            window.location.href = api.auth.loginUrl();
          }}
          className="rounded-xl h-11 px-6 shadow-xl shadow-accent/25 font-black uppercase tracking-widest text-[10px]"
        >
          {status?.github.tokenSet ? "Reconnect" : "Login with GitHub"}
        </Button>
      </div>

      {error && (
        <div className="p-4 rounded-2xl bg-danger/10 border border-danger/20 flex gap-3 items-center">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            className="text-danger shrink-0"
            aria-hidden="true"
          >
            <title>Error</title>
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
          <p className="text-xs font-bold text-danger">{error}</p>
        </div>
      )}

      {auth?.enabled === false && (
        <div className="p-4 rounded-2xl bg-warning/10 border border-warning/20 flex gap-3 items-center">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            className="text-warning shrink-0"
            aria-hidden="true"
          >
            <title>Warning</title>
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <p className="text-xs font-bold text-warning leading-relaxed">
            Missing Server Config: Please set GITHUB_OAUTH_CLIENT_ID and CLIENT_SECRET.
          </p>
        </div>
      )}
    </SettingsSection>
  );
}

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
    } catch (err) {
      setTestResult({ ok: false, error: err instanceof Error ? err.message : String(err) });
    } finally {
      setTesting(false);
    }
  };

  return (
    <SettingsSection title={`${label} Configuration`}>
      <form onSubmit={handleSave} className="space-y-6">
        {/* Connection status */}
        <div className="flex items-center gap-5 p-6 rounded-[2rem] bg-white/[0.02] border border-white/5 shadow-inner">
          <div
            className={`w-12 h-12 rounded-2xl flex items-center justify-center text-xl shadow-lg ${tokenSet ? "bg-accent/20 text-accent border border-accent/30" : "bg-white/5 text-muted"}`}
          >
            {provider === "gitlab" ? "🦊" : "🐙"}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-base font-black tracking-tight text-primary leading-none">
              {tokenSet ? "Connected" : "Disconnected"}
            </p>
            <div className="flex items-center gap-2 mt-2">
              <span
                className={`w-2 h-2 rounded-full ${tokenSet ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" : "bg-zinc-600"}`}
              />
              <span className="text-[10px] font-black uppercase tracking-widest text-muted">
                {username ? `@${username}` : "Access Token Required"}
              </span>
            </div>
          </div>
          {tokenSet && (
            <Button
              type="button"
              variant="ghost"
              onClick={handleTest}
              disabled={testing}
              className="rounded-xl h-10 px-6 font-black uppercase tracking-widest text-[9px] border-white/5"
            >
              {testing ? "Testing..." : "Test Connection"}
            </Button>
          )}
        </div>

        {testResult && (
          <div
            className={`p-4 rounded-2xl border flex gap-3 items-center ${
              testResult.ok
                ? "border-success/30 bg-success/15 text-success"
                : "border-danger/30 bg-danger/15 text-danger"
            }`}
          >
            {testResult.ok ? (
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
                className="shrink-0"
                aria-hidden="true"
              >
                <title>Success</title>
                <path d="M20 6L9 17l-5-5" />
              </svg>
            ) : (
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
                className="shrink-0"
                aria-hidden="true"
              >
                <title>Error</title>
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            )}
            <p className="text-xs font-bold leading-relaxed">
              {testResult.ok
                ? `Successfully authenticated as @${testResult.username}`
                : testResult.error}
            </p>
          </div>
        )}

        {error && (
          <div className="p-4 rounded-2xl border border-danger/30 bg-danger/15 text-danger flex gap-3 items-center">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              className="shrink-0"
              aria-hidden="true"
            >
              <title>Error</title>
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
            <p className="text-xs font-bold">{error}</p>
          </div>
        )}

        {showBaseUrl && (
          <div>
            <label
              htmlFor={baseUrlInputId}
              className="block text-[10px] font-black uppercase tracking-widest text-dimmed mb-2 ml-1"
            >
              Base URL
            </label>
            <Input
              id={baseUrlInputId}
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://gitlab.com"
              className="h-11 rounded-2xl bg-input/40 border-white/5 text-sm"
            />
            <p className="text-[10px] mt-1.5 ml-1 text-dimmed">
              For self-hosted GitLab instances, provide the full URL.
            </p>
          </div>
        )}

        {/* Token */}
        <div>
          <label
            htmlFor={tokenInputId}
            className="block text-[10px] font-black uppercase tracking-widest text-dimmed mb-2 ml-1"
          >
            Personal Access Token
          </label>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Input
                id={tokenInputId}
                type={showToken ? "text" : "password"}
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder={tokenSet ? "••••••••••••  (Token saved securely)" : tokenPlaceholder}
                autoComplete="off"
                className="h-11 rounded-2xl bg-input/40 border-white/5 text-sm"
              />
              <button
                type="button"
                onClick={() => setShowToken((v) => !v)}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-[10px] font-black uppercase tracking-widest text-accent hover:text-accent-hover transition-colors cursor-pointer"
              >
                {showToken ? "Hide" : "Show"}
              </button>
            </div>
            {tokenSet && (
              <Button
                type="button"
                variant="danger"
                onClick={handleClear}
                disabled={saving}
                className="rounded-2xl px-6 h-11"
              >
                Clear
              </Button>
            )}
          </div>
          <p className="text-[10px] mt-2 ml-1 text-dimmed leading-relaxed">
            {provider === "github" ? (
              <>
                Used for Pull Requests and merges. Requires the{" "}
                <code className="bg-white/5 px-1 py-0.5 rounded text-muted">repo</code> scope.
              </>
            ) : (
              <>
                Used for Merge Requests and project listing. Requires the{" "}
                <code className="bg-white/5 px-1 py-0.5 rounded text-muted">api</code> scope.
              </>
            )}
          </p>
        </div>

        <div className="flex items-center justify-between pt-4 border-t border-white/5">
          <div className="text-[10px] font-black uppercase tracking-widest text-success h-4 ml-1">
            {saved && "Changes applied!"}
          </div>
          <Button
            type="submit"
            variant="primary"
            disabled={saving || !token.trim()}
            className="rounded-2xl h-11 px-10 shadow-xl shadow-accent/25 font-black uppercase tracking-[0.15em] text-[10px]"
          >
            {saving ? "Persisting..." : "Save Configuration"}
          </Button>
        </div>
      </form>
    </SettingsSection>
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
    <SettingsSection title="LiteLLM Gateway">
      <form onSubmit={handleSave} className="space-y-6">
        {/* Enable/disable toggle */}
        <button
          type="button"
          onClick={handleToggle}
          className={`w-full flex items-center justify-between p-6 rounded-[2rem] border transition-all cursor-pointer group active-shrink ${
            enabled ? "bg-accent/5 border-accent/20" : "bg-white/5 border-white/5"
          }`}
        >
          <div className="flex-1 text-left">
            <span className="text-base font-black tracking-tight text-primary block">
              Enable LiteLLM Proxy
            </span>
            <p className="text-xs mt-1.5 text-muted leading-relaxed">
              {enabled
                ? "All intelligence requests will be routed through the LiteLLM gateway."
                : "Agents will use native API keys (token tracking and rate limiting disabled)."}
            </p>
          </div>
          <div
            className={`w-12 h-7 rounded-full relative transition-colors ml-4 shrink-0 ${enabled ? "bg-accent shadow-lg shadow-accent/20" : "bg-white/10"}`}
          >
            <div
              className={`absolute top-1 w-5 h-5 rounded-full bg-white transition-all shadow-sm ${enabled ? "left-6" : "left-1"}`}
            />
          </div>
        </button>

        {!enabled && (
          <div className="p-4 rounded-2xl bg-warning/10 border border-warning/20 flex gap-3 items-center">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              className="text-warning shrink-0"
              aria-hidden="true"
            >
              <title>Warning</title>
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <p className="text-xs font-bold text-warning leading-relaxed">
              Token tracking, rate limiting, and cost monitoring are currently disabled.
            </p>
          </div>
        )}

        {/* Health status */}
        <div
          className={`flex items-center gap-5 p-6 rounded-[2rem] border shadow-inner transition-opacity ${enabled ? "bg-white/[0.02] border-white/5" : "bg-black/20 border-white/5 opacity-50"}`}
        >
          <div
            className={`w-12 h-12 rounded-2xl flex items-center justify-center text-xl shadow-lg border ${
              health === null
                ? "bg-white/5 border-white/5"
                : health.ok
                  ? "bg-emerald-500/10 border-emerald-500/20"
                  : "bg-danger/10 border-danger/20"
            }`}
          >
            📡
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-base font-black tracking-tight text-primary leading-none">
              {health === null
                ? "Checking connection..."
                : health.ok
                  ? "Gateway Online"
                  : "Gateway Offline"}
            </p>
            <div className="flex items-center gap-2 mt-2">
              <span
                className={`w-2 h-2 rounded-full ${health === null ? "bg-zinc-500" : health.ok ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" : "bg-danger"}`}
              />
              <span className="text-[10px] font-black uppercase tracking-widest text-muted">
                {enabled ? "Active" : "Bypassed"}
              </span>
            </div>
          </div>
          <Button
            type="button"
            variant="ghost"
            onClick={() => window.open(`${baseUrl}/ui`, "_blank")}
            disabled={!enabled}
            className="rounded-xl h-10 px-6 font-black uppercase tracking-widest text-[9px] border-white/5"
          >
            Open Dashboard
          </Button>
        </div>

        {error && (
          <div className="p-4 rounded-2xl bg-danger/10 border border-danger/20 flex gap-3 items-center">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              className="text-danger shrink-0"
              aria-hidden="true"
            >
              <title>Error</title>
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
            <p className="text-xs font-bold text-danger">{error}</p>
          </div>
        )}

        <div>
          <label
            htmlFor={proxyUrlInputId}
            className="block text-[10px] font-black uppercase tracking-widest text-dimmed mb-2 ml-1"
          >
            Gateway URL
          </label>
          <Input
            id={proxyUrlInputId}
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="http://localhost:4000"
            autoComplete="off"
            disabled={!enabled}
            className="h-11 rounded-2xl bg-input/40 border-white/5 text-sm"
          />
          <p className="text-[10px] mt-2 ml-1 text-dimmed leading-relaxed">
            Local endpoint for LiteLLM. Server environment must also have{" "}
            <code className="bg-white/5 px-1 py-0.5 rounded text-muted">LITELLM_BASE_URL</code> and{" "}
            <code className="bg-white/5 px-1 py-0.5 rounded text-muted">LITELLM_MASTER_KEY</code>.
          </p>
        </div>

        <div className="flex items-center justify-between pt-4 border-t border-white/5">
          <div className="text-[10px] font-black uppercase tracking-widest text-success h-4 ml-1">
            {saved && "Changes applied!"}
          </div>
          <Button
            type="submit"
            variant="primary"
            disabled={saving || !enabled}
            className="rounded-2xl h-11 px-10 shadow-xl shadow-accent/25 font-black uppercase tracking-[0.15em] text-[10px]"
          >
            {saving ? "Persisting..." : "Save Configuration"}
          </Button>
        </div>
      </form>
    </SettingsSection>
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
    <form
      onSubmit={handleSave}
      className="p-6 rounded-[2rem] bg-white/[0.02] border border-white/5 space-y-4"
    >
      <div className="flex items-center gap-3">
        <span
          className={`w-2 h-2 rounded-full shrink-0 ${tokenSet ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" : "bg-zinc-600"}`}
        />
        <span className="text-sm font-black tracking-tight text-primary flex-1">{label}</span>
        <span className="text-[10px] font-black uppercase tracking-widest text-muted bg-white/5 px-2 py-0.5 rounded-lg border border-white/5">
          {tokenSet ? "Configured" : "Missing"}
        </span>
      </div>
      <p className="text-[11px] text-muted leading-relaxed opacity-80 pl-5">{description}</p>
      {error && (
        <div className="text-[10px] px-3 py-2 rounded-xl border border-danger/30 bg-danger/15 text-danger font-bold ml-5">
          {error}
        </div>
      )}
      <div className="flex gap-3 pl-5 pt-2">
        <div className="relative flex-1">
          <Input
            type={showVal ? "text" : "password"}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={tokenSet ? "•••••••••••• (Securely stored)" : placeholder}
            autoComplete="off"
            className="h-10 rounded-xl bg-input/40 border-white/5 text-xs"
          />
          <button
            type="button"
            onClick={() => setShowVal((v) => !v)}
            className="absolute right-4 top-1/2 -translate-y-1/2 text-[9px] font-black uppercase tracking-widest text-accent hover:text-accent-hover transition-colors cursor-pointer"
          >
            {showVal ? "Hide" : "Show"}
          </button>
        </div>
        {tokenSet && (
          <Button
            type="button"
            variant="danger"
            onClick={handleClear}
            disabled={saving}
            className="rounded-xl h-10 px-5"
          >
            Clear
          </Button>
        )}
        <Button
          type="submit"
          variant="primary"
          disabled={saving || !value.trim()}
          className="rounded-xl h-10 px-6 shadow-lg shadow-accent/20 font-black uppercase tracking-widest text-[9px]"
        >
          {saving ? "..." : saved ? "Saved!" : "Store Key"}
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
    <SettingsSection title="Native API Keys">
      <div className="p-4 rounded-2xl bg-blue-500/5 border border-blue-500/10 flex gap-3 mb-2">
        <div className="text-blue-400 mt-0.5">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            aria-hidden="true"
          >
            <title>Info</title>
            <circle cx="12" cy="12" r="10" />
            <path d="M12 16v-4M12 8h.01" />
          </svg>
        </div>
        <p className="text-[11px] text-blue-300/80 leading-relaxed font-medium">
          Native API keys act as fallbacks and are exclusively utilized when the LiteLLM Gateway
          proxy is disabled.
        </p>
      </div>

      <div className="space-y-3">
        <ApiKeyField
          label="Gemini API Key"
          description="Required for the native Gemini CLI. Generate a key at aistudio.google.com/apikey."
          settingKey="geminiApiKey"
          placeholder="AIzaSy..."
          tokenSet={keys.gemini}
          onSaved={load}
        />
        <ApiKeyField
          label="Anthropic API Key"
          description="Required for native Claude Code operation. Obtain from console.anthropic.com."
          settingKey="anthropicApiKey"
          placeholder="sk-ant-..."
          tokenSet={keys.anthropic}
          onSaved={load}
        />
        <ApiKeyField
          label="OpenAI API Key"
          description="Required for Aider and generic OpenAI-compatible engines."
          settingKey="openaiApiKey"
          placeholder="sk-..."
          tokenSet={keys.openai}
          onSaved={load}
        />
      </div>
    </SettingsSection>
  );
}

function GeneralTab() {
  const { themeName, setTheme } = useTheme();
  const [maxAgents, setMaxAgents] = useState(4);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.settings
      .get()
      .then((s) => setMaxAgents(s.maxAgents ?? 4))
      .catch(() => {});
  }, []);

  const handleMaxAgentsChange = async (value: number) => {
    const clamped = Math.max(1, Math.min(50, value));
    setMaxAgents(clamped);
    setSaving(true);
    try {
      await api.settings.update({ maxAgents: clamped });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-8">
      <SettingsSection title="Appearance & Experience">
        <div>
          <div className="grid grid-cols-2 gap-3">
            {Object.values(themes).map((t) => (
              <button
                key={t.name}
                type="button"
                onClick={() => {
                  setTheme(t.name);
                  api.settings.update({ theme: t.name }).catch(() => {});
                }}
                className={`relative p-5 rounded-[1.5rem] border-2 transition-all active-shrink cursor-pointer text-left group overflow-hidden ${
                  themeName === t.name
                    ? "border-accent bg-accent/5 shadow-lg shadow-accent/10"
                    : "border-white/5 bg-surface/30 hover:border-white/10 hover:bg-surface/50"
                }`}
              >
                <div className="relative z-10 flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-4 h-4 rounded-full" style={{ background: t.colors.accent }} />
                    <span className="text-sm font-black tracking-tight text-primary">
                      {t.label}
                    </span>
                  </div>
                  {themeName === t.name && (
                    <div className="w-5 h-5 rounded-full bg-accent flex items-center justify-center shadow-lg animate-in zoom-in duration-200">
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="4"
                        className="text-white"
                        aria-hidden="true"
                      >
                        <title>Selected</title>
                        <path d="M20 6L9 17l-5-5" />
                      </svg>
                    </div>
                  )}
                </div>
                <div className="relative z-10 flex gap-1.5">
                  <div
                    className="h-1.5 flex-1 rounded-full opacity-60"
                    style={{ background: t.colors.success }}
                  />
                  <div
                    className="h-1.5 flex-1 rounded-full opacity-60"
                    style={{ background: t.colors.warning }}
                  />
                  <div
                    className="h-1.5 flex-1 rounded-full opacity-60"
                    style={{ background: t.colors.danger }}
                  />
                  <div
                    className="h-1.5 flex-1 rounded-full opacity-60"
                    style={{ background: t.colors.info }}
                  />
                </div>
                <div
                  className="absolute inset-0 opacity-10 group-hover:opacity-20 transition-opacity"
                  style={{
                    background: `radial-gradient(circle at top right, ${t.colors.accent}, transparent)`,
                  }}
                />
              </button>
            ))}
          </div>
        </div>
      </SettingsSection>

      <SettingsSection title="Agent Concurrency">
        <div className="p-5 rounded-[1.5rem] bg-white/[0.02] border border-white/5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-black tracking-tight text-primary">Max Parallel Agents</p>
              <p className="text-[10px] text-dimmed mt-0.5">
                How many agents can run simultaneously (1–10)
              </p>
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => handleMaxAgentsChange(maxAgents - 1)}
                disabled={maxAgents <= 1 || saving}
                className="w-8 h-8 rounded-xl bg-white/5 border border-white/10 text-primary font-black hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-all cursor-pointer"
              >
                −
              </button>
              <span className="text-2xl font-black text-accent w-8 text-center tabular-nums">
                {maxAgents}
              </span>
              <button
                type="button"
                onClick={() => handleMaxAgentsChange(maxAgents + 1)}
                disabled={maxAgents >= 50 || saving}
                className="w-8 h-8 rounded-xl bg-white/5 border border-white/10 text-primary font-black hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-all cursor-pointer"
              >
                +
              </button>
            </div>
          </div>
          <input
            type="range"
            min={1}
            max={50}
            value={maxAgents}
            onChange={(e) => handleMaxAgentsChange(Number(e.target.value))}
            className="w-full accent-[var(--color-accent)] cursor-pointer"
          />
          <div className="flex justify-between text-[9px] font-black uppercase tracking-widest text-dimmed">
            <span>1 agent</span>
            <span>10 agents</span>
          </div>
        </div>
      </SettingsSection>
    </div>
  );
}

function TelegramTab() {
  const [botToken, setBotToken] = useState("");
  const [chatId, setChatId] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; error?: string } | null>(null);
  const [loaded, setLoaded] = useState(false);
  const id = useId();

  useEffect(() => {
    api.settings
      .get()
      .then((s) => {
        if (s.telegram) {
          setBotToken(s.telegram.botToken ?? "");
          setChatId(s.telegram.chatId ?? "");
          setEnabled(s.telegram.enabled ?? true);
        }
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setTestResult(null);
    try {
      await api.settings.update({
        telegramBotToken: botToken,
        telegramChatId: chatId,
        telegramEnabled: enabled,
      });
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/settings/test/telegram", { method: "POST" });
      const json = (await res.json()) as { data: { ok: boolean; error?: string } };
      setTestResult(json.data);
    } catch (err) {
      setTestResult({ ok: false, error: err instanceof Error ? err.message : String(err) });
    } finally {
      setTesting(false);
    }
  };

  if (!loaded) return <div className="text-sm text-muted py-8 text-center">Loading...</div>;

  return (
    <div className="space-y-8">
      <SettingsSection title="Telegram Notifications">
        <div className="space-y-4">
          <p className="text-[11px] text-muted leading-relaxed">
            Receive notifications when merge conflicts are resolved, CI failures are detected, and
            more. Create a bot via <span className="text-accent font-mono">@BotFather</span> and get
            your Chat ID via <span className="text-accent font-mono">@userinfobot</span>.
          </p>

          <div className="flex items-center justify-between p-3 rounded-xl bg-input/30 border border-white/5">
            <div>
              <p className="text-xs font-semibold text-primary">Enable Telegram notifications</p>
              <p className="text-[10px] text-muted mt-0.5">Send alerts when events occur</p>
            </div>
            <button
              type="button"
              onClick={() => setEnabled((v) => !v)}
              className={`relative w-10 h-5.5 rounded-full transition-colors cursor-pointer ${enabled ? "bg-accent" : "bg-input"}`}
            >
              <span
                className={`absolute top-0.5 w-4.5 h-4.5 rounded-full bg-white shadow transition-transform ${enabled ? "translate-x-[22px]" : "translate-x-0.5"}`}
              />
            </button>
          </div>

          <div>
            <label
              htmlFor={`${id}-token`}
              className="text-[10px] font-bold uppercase tracking-widest text-muted block mb-2"
            >
              Bot Token
            </label>
            <Input
              id={`${id}-token`}
              type="password"
              value={botToken}
              onChange={(e) => setBotToken(e.target.value)}
              placeholder="1234567890:AAFxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
              className="font-mono text-xs"
            />
          </div>

          <div>
            <label
              htmlFor={`${id}-chat`}
              className="text-[10px] font-bold uppercase tracking-widest text-muted block mb-2"
            >
              Chat ID
            </label>
            <Input
              id={`${id}-chat`}
              value={chatId}
              onChange={(e) => setChatId(e.target.value)}
              placeholder="-1001234567890 or 123456789"
              className="font-mono text-xs"
            />
            <p className="text-[10px] text-muted mt-1.5">
              Group/channel IDs start with <span className="font-mono">-100</span>. For personal
              chats, use your numeric user ID.
            </p>
          </div>

          {testResult && (
            <div
              className={`p-3 rounded-xl text-xs font-medium ${testResult.ok ? "bg-success/10 text-success border border-success/20" : "bg-danger/10 text-danger border border-danger/20"}`}
            >
              {testResult.ok ? "✅ Test message sent successfully!" : `❌ ${testResult.error}`}
            </div>
          )}

          <div className="flex gap-2 pt-2">
            <Button
              type="button"
              variant="ghost"
              onClick={handleTest}
              disabled={testing || !botToken || !chatId}
              className="flex-1 h-9 text-xs"
            >
              {testing ? "Sending..." : "Send Test Message"}
            </Button>
            <Button
              type="button"
              variant="primary"
              onClick={handleSave}
              disabled={saving}
              className="flex-1 h-9 text-xs"
            >
              {saving ? "Saving..." : "Save"}
            </Button>
          </div>
        </div>
      </SettingsSection>

      <SettingsSection title="Notification Events">
        <div className="space-y-2">
          {[
            {
              label: "Merge conflict detected",
              desc: "When a PR has conflicts and auto-resolution starts",
            },
            {
              label: "Merge conflict resolved",
              desc: "When conflicts are fixed and pushed successfully",
            },
          ].map((item) => (
            <div
              key={item.label}
              className="flex items-center gap-3 p-3 rounded-xl bg-input/20 border border-white/5"
            >
              <div className="w-1.5 h-1.5 rounded-full bg-success shrink-0" />
              <div>
                <p className="text-xs font-semibold text-primary">{item.label}</p>
                <p className="text-[10px] text-muted">{item.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </SettingsSection>
    </div>
  );
}

function McpTab() {
  const nameInputId = useId();
  const commandInputId = useId();
  const urlInputId = useId();
  const [mcpServers, setMcpServers] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // New server form state
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState<"local" | "remote">("local");
  const [newCommand, setNewCommand] = useState("");
  const [newUrl, setNewUrl] = useState("");
  const [envKeys, setEnvKeys] = useState<string[]>([""]);
  const [envValues, setEnvValues] = useState<string[]>([""]);

  const load = useCallback(() => {
    setLoading(true);
    api.settings
      .get()
      .then((s) => {
        setMcpServers(s.mcpServers ?? {});
        setLoading(false);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleToggleServer = async (name: string) => {
    const updated = { ...mcpServers };
    if (updated[name]) {
      updated[name] = { ...updated[name], enabled: !updated[name].enabled };
      setMcpServers(updated);
      try {
        await api.settings.update({ mcpServers: updated });
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    }
  };

  const handleDeleteServer = async (name: string) => {
    const updated = { ...mcpServers };
    delete updated[name];
    setMcpServers(updated);
    try {
      await api.settings.update({ mcpServers: updated });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleAddEnvRow = () => {
    setEnvKeys([...envKeys, ""]);
    setEnvValues([...envValues, ""]);
  };

  const handleRemoveEnvRow = (index: number) => {
    const keys = [...envKeys];
    const vals = [...envValues];
    keys.splice(index, 1);
    vals.splice(index, 1);
    setEnvKeys(keys);
    setEnvValues(vals);
  };

  const handleAddServer = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = newName.trim().toLowerCase();
    if (!name) return;

    const serverConfig: any = {
      type: newType,
      enabled: true,
    };

    if (newType === "local") {
      serverConfig.command = newCommand
        .split(/\s+/)
        .map((s) => s.trim())
        .filter(Boolean);
    } else {
      serverConfig.url = newUrl.trim();
    }

    // Build environment variables
    const environment: Record<string, string> = {};
    for (let i = 0; i < envKeys.length; i++) {
      const k = envKeys[i].trim();
      const v = envValues[i].trim();
      if (k && v) {
        environment[k] = v;
      }
    }
    if (Object.keys(environment).length > 0) {
      serverConfig.environment = environment;
    }

    const updated = { ...mcpServers, [name]: serverConfig };
    setSaving(true);
    try {
      await api.settings.update({ mcpServers: updated });
      setMcpServers(updated);
      // Reset form
      setNewName("");
      setNewCommand("");
      setNewUrl("");
      setEnvKeys([""]);
      setEnvValues([""]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="text-sm text-muted py-8 text-center">Loading MCP Configuration...</div>;
  }

  return (
    <div className="space-y-8">
      <SettingsSection title="Model Context Protocol (MCP)">
        <p className="text-[11px] text-muted leading-relaxed">
          MCP is an open standard that enables secure integration of tools and data sources into AI
          systems. Configure MCP servers below to grant agent engines access to additional utilities
          (such as search tools, database clients, or github management APIs).
        </p>

        {error && (
          <div className="p-4 rounded-2xl bg-danger/10 border border-danger/20 flex gap-3 items-center text-danger text-xs font-bold">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              className="shrink-0"
              aria-hidden="true"
            >
              <title>Error</title>
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
            <p>{error}</p>
          </div>
        )}

        {/* MCP Server List */}
        <div className="space-y-3">
          {Object.keys(mcpServers).length === 0 ? (
            <div className="p-6 rounded-[2rem] border border-white/5 bg-white/[0.01] text-center text-xs text-muted">
              No custom MCP servers configured. (GitHub MCP will still activate automatically if a
              token is available)
            </div>
          ) : (
            Object.entries(mcpServers).map(([name, config]: [string, any]) => (
              <div
                key={name}
                className="p-5 rounded-[2rem] bg-white/[0.02] border border-white/5 flex items-start gap-4 transition-all"
              >
                <div
                  className={`w-10 h-10 rounded-xl flex items-center justify-center text-lg shrink-0 ${
                    config.enabled
                      ? "bg-accent/15 text-accent border border-accent/20"
                      : "bg-white/5 text-muted border border-white/5"
                  }`}
                >
                  🔌
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-black text-primary tracking-tight">{name}</span>
                    <span className="text-[9px] font-black uppercase tracking-widest text-muted px-1.5 py-0.5 rounded bg-white/5">
                      {config.type}
                    </span>
                  </div>
                  <p className="text-[10px] text-muted mt-1 truncate font-mono">
                    {config.type === "local"
                      ? Array.isArray(config.command)
                        ? config.command.join(" ")
                        : config.command
                      : config.url}
                  </p>
                  {config.environment && Object.keys(config.environment).length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {Object.keys(config.environment).map((k) => (
                        <span
                          key={k}
                          className="text-[8px] font-mono bg-white/5 border border-white/5 rounded px-1.5 py-0.5 text-muted"
                        >
                          {k}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  {/* Enable/Disable Toggle */}
                  <button
                    type="button"
                    onClick={() => handleToggleServer(name)}
                    className={`relative w-9 h-5 rounded-full transition-colors cursor-pointer shrink-0 ${
                      config.enabled ? "bg-accent" : "bg-white/10"
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                        config.enabled ? "translate-x-4" : ""
                      }`}
                    />
                  </button>
                  {/* Delete Button */}
                  <Button
                    type="button"
                    variant="danger"
                    onClick={() => handleDeleteServer(name)}
                    className="h-8 rounded-xl px-3 text-[9px] font-black uppercase tracking-widest shadow-inner shadow-danger/10"
                  >
                    Delete
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>
      </SettingsSection>

      {/* Add new MCP server form */}
      <SettingsSection title="Register New MCP Server">
        <form
          onSubmit={handleAddServer}
          className="p-6 rounded-[2rem] bg-white/[0.02] border border-white/5 space-y-5"
        >
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label
                htmlFor={nameInputId}
                className="block text-[10px] font-black uppercase tracking-widest text-dimmed mb-2 ml-1"
              >
                Server Identifier Name
              </label>
              <Input
                id={nameInputId}
                required
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. brave-search"
                className="h-10 rounded-xl bg-input/40 border-white/5 text-xs font-mono"
              />
            </div>
            <div>
              <div className="block text-[10px] font-black uppercase tracking-widest text-dimmed mb-2 ml-1">
                Connection Type
              </div>
              <div className="flex gap-2 p-1 rounded-xl bg-input/40 border border-white/5">
                {(["local", "remote"] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setNewType(t)}
                    className={`flex-1 text-[9px] font-black uppercase tracking-widest py-1.5 rounded-lg transition-all cursor-pointer ${
                      newType === t
                        ? "bg-accent text-white shadow"
                        : "text-muted hover:text-primary"
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {newType === "local" ? (
            <div>
              <label
                htmlFor={commandInputId}
                className="block text-[10px] font-black uppercase tracking-widest text-dimmed mb-2 ml-1"
              >
                Command / Arguments
              </label>
              <Input
                id={commandInputId}
                required={newType === "local"}
                value={newCommand}
                onChange={(e) => setNewCommand(e.target.value)}
                placeholder="e.g. npx -y @modelcontextprotocol/server-postgres postgres://localhost:5432"
                className="h-10 rounded-xl bg-input/40 border-white/5 text-xs font-mono"
              />
              <p className="text-[9px] mt-1 ml-1 text-dimmed">
                The command line to launch this MCP server. Words will be parsed as arguments
                automatically.
              </p>
            </div>
          ) : (
            <div>
              <label
                htmlFor={urlInputId}
                className="block text-[10px] font-black uppercase tracking-widest text-dimmed mb-2 ml-1"
              >
                Remote Server Endpoint URL
              </label>
              <Input
                id={urlInputId}
                required={newType === "remote"}
                value={newUrl}
                onChange={(e) => setNewUrl(e.target.value)}
                placeholder="e.g. https://mcp.exa.ai/mcp"
                className="h-10 rounded-xl bg-input/40 border-white/5 text-xs font-mono"
              />
            </div>
          )}

          {/* Environment Variables */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <div className="block text-[10px] font-black uppercase tracking-widest text-dimmed ml-1">
                Environment Variables (Secrets/Config)
              </div>
              <button
                type="button"
                onClick={handleAddEnvRow}
                className="text-[9px] font-black uppercase tracking-widest text-accent hover:text-accent-hover transition-colors cursor-pointer"
              >
                + Add Variable
              </button>
            </div>

            <div className="space-y-2">
              {envKeys.map((key, idx) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: idx is stable and unique for rows
                <div key={idx} className="flex gap-2 items-center">
                  <Input
                    value={key}
                    onChange={(e) => {
                      const updatedKeys = [...envKeys];
                      updatedKeys[idx] = e.target.value;
                      setEnvKeys(updatedKeys);
                    }}
                    placeholder="KEY"
                    className="h-9 rounded-lg bg-input/30 border-white/5 text-[11px] font-mono flex-1"
                  />
                  <Input
                    value={envValues[idx]}
                    onChange={(e) => {
                      const updatedVals = [...envValues];
                      updatedVals[idx] = e.target.value;
                      setEnvValues(updatedVals);
                    }}
                    placeholder="VALUE"
                    className="h-9 rounded-lg bg-input/30 border-white/5 text-[11px] font-mono flex-1"
                  />
                  {(envKeys.length > 1 || key || envValues[idx]) && (
                    <button
                      type="button"
                      onClick={() => handleRemoveEnvRow(idx)}
                      className="text-[10px] font-bold text-danger hover:text-red-400 p-1 cursor-pointer"
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="flex justify-end pt-2">
            <Button
              type="submit"
              variant="primary"
              disabled={saving || !newName.trim()}
              className="rounded-xl h-10 px-8 shadow-lg shadow-accent/20 font-black uppercase tracking-widest text-[9px]"
            >
              {saving ? "Registering..." : "Add MCP Server"}
            </Button>
          </div>
        </form>
      </SettingsSection>
    </div>
  );
}

export function SettingsDialog({ open, onClose }: SettingsDialogProps) {
  const [tab, setTab] = useState<Tab>("github");

  return (
    <Dialog open={open} onClose={onClose} title="System Configuration" size="2xl">
      {/* Modern High-End Tabs */}
      <div className="flex gap-2 mb-8 p-1.5 rounded-[1.25rem] bg-input/40 border border-white/5 backdrop-blur-md">
        {(["github", "gitlab", "litellm", "apikeys", "general", "telegram", "mcp"] as Tab[]).map(
          (t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`flex-1 text-[11px] font-black uppercase tracking-widest py-2.5 rounded-xl transition-all active-shrink cursor-pointer ${
                tab === t
                  ? "bg-accent text-white shadow-lg shadow-accent/25"
                  : "text-muted hover:text-primary hover:bg-white/5"
              }`}
            >
              {t === "apikeys" ? "API Keys" : t === "mcp" ? "MCP" : t}
            </button>
          )
        )}
      </div>

      <div className="min-h-[320px] max-h-[60vh] overflow-y-auto pr-2 custom-scrollbar">
        {tab === "github" && <GitHubOAuthTab />}

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

        {tab === "general" && <GeneralTab />}

        {tab === "telegram" && <TelegramTab />}

        {tab === "mcp" && <McpTab />}
      </div>

      <div className="mt-8 pt-6 border-t border-white/5 flex justify-end">
        <Button
          variant="ghost"
          onClick={onClose}
          className="rounded-xl h-11 px-8 font-black uppercase tracking-widest text-[10px] bg-white/5 border-white/10 hover:bg-white/10"
        >
          Close Settings
        </Button>
      </div>
    </Dialog>
  );
}
