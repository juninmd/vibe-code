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

export function SettingsDialog({ open, onClose }: SettingsDialogProps) {
  const [tab, setTab] = useState<Tab>("github");
  const { themeName, setTheme } = useTheme();

  return (
    <Dialog open={open} onClose={onClose} title="System Configuration" size="2xl">
      {/* Modern High-End Tabs */}
      <div className="flex gap-2 mb-8 p-1.5 rounded-[1.25rem] bg-input/40 border border-white/5 backdrop-blur-md">
        {(["github", "gitlab", "litellm", "apikeys", "general"] as Tab[]).map((t) => (
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
            {t === "apikeys" ? "API Keys" : t}
          </button>
        ))}
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

        {tab === "general" && (
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
                        <div
                          className="w-4 h-4 rounded-full"
                          style={{ background: t.colors.accent }}
                        />
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

                    {/* Background visual flair */}
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
        )}
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
