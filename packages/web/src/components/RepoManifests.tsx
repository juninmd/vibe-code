import { useEffect, useState } from "react";
import { api } from "../api/client";
import { Dialog } from "./ui/dialog";
import { AiderIcon, ClaudeIcon, GeminiIcon, OpenCodeIcon } from "./ui/engine-icons";
import { GitHubIcon } from "./ui/git-icons";

interface RepoManifestsProps {
  repoId: string;
}

export function RepoManifests({ repoId }: RepoManifestsProps) {
  const [manifests, setManifests] = useState<Record<string, string>>({});
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    api.repos
      .manifests(repoId)
      .then((data) => {
        if (mounted) setManifests(data);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [repoId]);

  const fileEntries = Object.entries(manifests);

  if (loading) {
    return (
      <div className="mt-4 border-t border-default/50 pt-4 shrink-0">
        <h4 className="text-[10px] font-bold uppercase tracking-wider text-primary0 mb-2 px-2">
          Manifestos do Agente
        </h4>
        <div className="text-xs text-primary0 px-2 animate-pulse">Carregando...</div>
      </div>
    );
  }

  const getFileIcon = (filename: string) => {
    if (filename === "GEMINI.md") return <GeminiIcon className="text-info" size={14} />;
    if (filename === "CLAUDE.md" || filename === ".claude.instructions.md")
      return <ClaudeIcon className="text-warning" size={14} />;
    if (filename === "CONVENTIONS.md" || filename === ".aider.instructions.md")
      return <AiderIcon className="text-success" size={14} />;
    if (filename === "AGENTS.md") return <OpenCodeIcon className="text-accent-text" size={14} />;
    if (filename.includes("copilot")) return <GitHubIcon className="text-secondary" size={14} />;
    return (
      <svg
        aria-hidden="true"
        width="14"
        height="14"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        className="text-secondary"
      >
        <path d="M4 2h5l3 3v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z" />
        <path d="M9 2v3h3" />
      </svg>
    );
  };

  return (
    <div className="mt-4 border-t border-default/50 pt-4 shrink-0">
      <h4 className="text-[10px] font-bold uppercase tracking-wider text-primary0 mb-2 px-2">
        Manifestos do Agente
      </h4>

      {fileEntries.length === 0 ? (
        <div className="text-[11px] text-dimmed px-2 italic">
          Nenhum manifesto nativo encontrado na raiz do projeto.
        </div>
      ) : (
        <div className="space-y-1">
          {fileEntries.map(([filename]) => (
            <button
              key={filename}
              type="button"
              onClick={() => setSelectedFile(filename)}
              className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-secondary hover:text-primary hover:bg-surface-hover/50 rounded transition-colors group"
            >
              {getFileIcon(filename)}
              <span className="truncate">{filename}</span>
            </button>
          ))}
        </div>
      )}

      <Dialog
        open={!!selectedFile}
        onClose={() => setSelectedFile(null)}
        title={selectedFile ?? ""}
        size="2xl"
      >
        <div className="flex-1 overflow-auto bg-app rounded border border-default p-4 font-mono text-xs whitespace-pre-wrap text-secondary max-h-[60vh]">
          {selectedFile ? manifests[selectedFile] : ""}
        </div>
      </Dialog>
    </div>
  );
}
