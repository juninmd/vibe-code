import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../../api/client";
import { Button } from "../../ui/Button";
import { Icon } from "./Icon";

/** Opens the session's worktree in VS Code (code-server) in a new tab. */
export function VsCodeButton({ taskId }: { taskId: string }) {
  const status = useQuery({
    queryKey: ["vscode-status"],
    queryFn: api.vscode.status,
    retry: false,
    staleTime: 60_000,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const available = status.data?.available ?? false;
  const open = async () => {
    setBusy(true);
    setError("");
    // Open the tab inside the click so popup blockers allow it, then point it at the editor.
    const tab = window.open("", "_blank");
    try {
      const { url } = await api.vscode.open(taskId);
      if (tab) tab.location.href = url;
      else window.location.assign(url);
    } catch (err) {
      tab?.close();
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Button
        loading={busy}
        disabled={busy || !available}
        aria-label="Abrir no VS Code"
        title={
          available
            ? "Abrir o workspace no VS Code do navegador"
            : "code-server não está instalado no servidor"
        }
        iconStart={<Icon name="code" size={13} />}
        onClick={() => void open()}
      >
        <span className="rw-desktop-label">{busy ? "Abrindo…" : "VS Code"}</span>
      </Button>
      {error && (
        <span className="rw-pr-error" role="alert">
          {error}
        </span>
      )}
    </>
  );
}
