import type { SettingsResponse } from "@vibe-code/shared";
import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client";
import { useTheme } from "../theme/ThemeProvider";
import { themes } from "../theme/themes";
import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";

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
          className="rounded-xl h-11 px-6 shadow-xl shadow-accent/25"
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
          >
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
          >
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
            {t}
          </button>
        ))}
      </div>

      <div className="min-h-[320px]">
        {tab === "github" && <GitHubOAuthTab />}

        {/* Simplified placeholders for now to keep focus on UI structural modernization */}
        {tab !== "github" && tab !== "general" && (
          <div className="flex flex-col items-center justify-center h-64 opacity-50 space-y-4">
            <p className="text-4xl">⚙</p>
            <p className="text-[10px] font-black uppercase tracking-[0.3em] text-dimmed">
              {tab} Settings Modernization
            </p>
          </div>
        )}

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
                          >
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

      <div className="mt-10 pt-6 border-t border-white/5 flex justify-end">
        <Button
          variant="ghost"
          onClick={onClose}
          className="rounded-xl h-11 px-8 font-black uppercase tracking-widest text-[10px]"
        >
          Close Settings
        </Button>
      </div>
    </Dialog>
  );
}
