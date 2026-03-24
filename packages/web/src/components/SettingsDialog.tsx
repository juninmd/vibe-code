import { useState, useEffect } from "react";
import { Dialog } from "./ui/dialog";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { api } from "../api/client";

interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
}

export function SettingsDialog({ open, onClose }: SettingsDialogProps) {
  const [githubToken, setGithubToken] = useState("");
  const [tokenSet, setTokenSet] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!open) return;
    setGithubToken("");
    setShowToken(false);
    setSaved(false);
    api.settings.get().then((s) => {
      setTokenSet(s.githubTokenSet);
    }).catch(console.error);
  }, [open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.settings.update({ githubToken });
      setTokenSet(!!githubToken);
      setGithubToken("");
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
      await api.settings.update({ githubToken: "" });
      setTokenSet(false);
      setGithubToken("");
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} title="Settings">
      <form onSubmit={handleSubmit} className="space-y-5">
        {/* GitHub Token */}
        <div>
          <label className="block text-xs font-medium text-zinc-400 mb-1">
            GitHub Token
          </label>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Input
                type={showToken ? "text" : "password"}
                value={githubToken}
                onChange={(e) => setGithubToken(e.target.value)}
                placeholder={tokenSet ? "••••••••••••  (token saved)" : "ghp_xxxxxxxxxxxx"}
                autoComplete="off"
              />
              <button
                type="button"
                onClick={() => setShowToken((v) => !v)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 text-xs cursor-pointer"
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
          <p className="text-xs text-zinc-600 mt-1.5">
            Used for PR merge polling. Requires{" "}
            <code className="text-zinc-500">repo</code> scope.{" "}
            {tokenSet && (
              <span className="text-emerald-500">Token is currently set.</span>
            )}
          </p>
        </div>

        <div className="flex items-center justify-between pt-1">
          <div className="text-xs text-emerald-400 h-4">
            {saved && "Saved!"}
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={saving || !githubToken.trim()}>
              {saving ? "Saving..." : "Save"}
            </Button>
          </div>
        </div>
      </form>
    </Dialog>
  );
}
