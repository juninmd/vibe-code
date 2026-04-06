import { useEffect, useState } from "react";
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

type Tab = "github" | "gitlab" | "general";

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
  const [token, setToken] = useState("");
  const [baseUrl, setBaseUrl] = useState("https://gitlab.com");
  const [tokenSet, setTokenSet] = useState(false);
  const [username, setUsername] = useState<string | undefined>();
  const [showToken, setShowToken] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    username?: string;
    error?: string;
  } | null>(null);

  useEffect(() => {
    setToken("");
    setShowToken(false);
    setSaved(false);
    setTestResult(null);
    api.settings
      .get()
      .then((s: any) => {
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
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  const handleClear = async () => {
    setSaving(true);
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
      console.error(err);
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
            {tokenSet ? "Connected" : "Not connected"}
          </span>
          {username && (
            <span className="text-xs ml-2" style={{ color: "var(--text-muted)" }}>
              @{username}
            </span>
          )}
        </div>
        {tokenSet && (
          <Button type="button" variant="ghost" size="sm" onClick={handleTest} disabled={testing}>
            {testing ? "Testing..." : "Test"}
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
          {testResult.ok ? `✓ Connected as @${testResult.username}` : `✕ ${testResult.error}`}
        </div>
      )}

      {showBaseUrl && (
        <div>
          <label className="block text-xs font-medium mb-1" style={{ color: "var(--text-muted)" }}>
            Base URL
          </label>
          <Input
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://gitlab.com"
          />
          <p className="text-xs mt-1" style={{ color: "var(--text-dimmed)" }}>
            Self-hosted GitLab? Enter your instance URL.
          </p>
        </div>
      )}

      {/* Token */}
      <div>
        <label className="block text-xs font-medium mb-1" style={{ color: "var(--text-muted)" }}>
          {label} Token
        </label>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Input
              type={showToken ? "text" : "password"}
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder={tokenSet ? "••••••••••••  (token saved)" : tokenPlaceholder}
              autoComplete="off"
            />
            <button
              type="button"
              onClick={() => setShowToken((v) => !v)}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs cursor-pointer"
              style={{ color: "var(--text-dimmed)" }}
            >
              {showToken ? "hide" : "show"}
            </button>
          </div>
          {tokenSet && (
            <Button type="button" variant="ghost" onClick={handleClear} disabled={saving}>
              Clear
            </Button>
          )}
        </div>
        <p className="text-xs mt-1.5" style={{ color: "var(--text-dimmed)" }}>
          {provider === "github" ? (
            <>
              Used for PR creation and merge polling. Requires{" "}
              <code style={{ color: "var(--text-muted)" }}>repo</code> scope.
            </>
          ) : (
            <>
              Used for Merge Requests and project listing. Requires{" "}
              <code style={{ color: "var(--text-muted)" }}>api</code> scope.
            </>
          )}
        </p>
      </div>

      <div className="flex items-center justify-between pt-1">
        <div className="text-xs h-4" style={{ color: "var(--success)" }}>
          {saved && "Saved!"}
        </div>
        <Button type="submit" variant="primary" disabled={saving || !token.trim()}>
          {saving ? "Saving..." : "Save"}
        </Button>
      </div>
    </form>
  );
}

export function SettingsDialog({ open, onClose }: SettingsDialogProps) {
  const [tab, setTab] = useState<Tab>("github");
  const { themeName, setTheme } = useTheme();

  return (
    <Dialog open={open} onClose={onClose} title="Settings">
      {/* Tabs */}
      <div className="flex gap-1 mb-5 rounded-lg p-1" style={{ background: "var(--bg-input)" }}>
        {(["github", "gitlab", "general"] as Tab[]).map((t) => (
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
            {t === "github" ? "GitHub" : t === "gitlab" ? "GitLab" : "Geral"}
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

      {tab === "general" && (
        <div className="space-y-5">
          {/* Theme selector */}
          <div>
            <label
              className="block text-xs font-medium mb-2"
              style={{ color: "var(--text-muted)" }}
            >
              Tema
            </label>
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
              Close
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
