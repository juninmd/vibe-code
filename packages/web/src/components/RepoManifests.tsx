import { useEffect, useState } from "react";
import { api } from "../api/client";
import { Dialog } from "./ui/dialog";
import { AiderIcon, ClaudeIcon, GeminiIcon, OpenCodeIcon } from "./ui/engine-icons";
import { GitHubIcon } from "./ui/git-icons";

interface RepoManifestsProps {
  repoId: string;
}

interface ManifestSource {
  source: "repo" | "global";
  filename: string;
  content: string;
}

export function RepoManifests({ repoId }: RepoManifestsProps) {
  const [manifests, setManifests] = useState<ManifestSource[]>([]);
  const [selectedFile, setSelectedFile] = useState<ManifestSource | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    setLoading(true);

    Promise.all([api.repos.manifests(repoId), api.skills.manifests()])
      .then(([repoManifests, globalManifests]) => {
        if (!mounted) return;

        const sources: ManifestSource[] = [];

        for (const [filename, content] of Object.entries(repoManifests)) {
          sources.push({ source: "repo", filename, content });
        }
        for (const [filename, content] of Object.entries(globalManifests)) {
          sources.push({ source: "global", filename, content });
        }

        setManifests(sources);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [repoId]);

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

      {loading ? (
        <div className="text-xs text-primary0 px-2 animate-pulse">Carregando...</div>
      ) : manifests.length === 0 ? (
        <div className="text-[11px] text-dimmed px-2 italic">
          Nenhum manifesto nativo encontrado.
        </div>
      ) : (
        <div className="space-y-3">
          {(() => {
            const repoManifests = manifests.filter((m) => m.source === "repo");
            const globalManifests = manifests.filter((m) => m.source === "global");
            return (
              <>
                {repoManifests.length > 0 && (
                  <div>
                    <div className="text-[9px] text-dimmed uppercase tracking-wider px-2 mb-1">
                      Repositório
                    </div>
                    <div className="space-y-1">
                      {repoManifests.map(({ filename, content }) => (
                        <button
                          key={`repo-${filename}`}
                          type="button"
                          onClick={() => setSelectedFile({ source: "repo", filename, content })}
                          className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-secondary hover:text-primary hover:bg-surface-hover/50 rounded transition-colors group"
                        >
                          {getFileIcon(filename)}
                          <span className="truncate">{filename}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {globalManifests.length > 0 && (
                  <div>
                    <div className="text-[9px] text-dimmed uppercase tracking-wider px-2 mb-1">
                      Global (~/.agents)
                    </div>
                    <div className="space-y-1">
                      {globalManifests.map(({ filename, content }) => (
                        <button
                          key={`global-${filename}`}
                          type="button"
                          onClick={() => setSelectedFile({ source: "global", filename, content })}
                          className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-secondary hover:text-primary hover:bg-surface-hover/50 rounded transition-colors group"
                        >
                          {getFileIcon(filename)}
                          <span className="truncate">{filename}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </>
            );
          })()}
        </div>
      )}

      <Dialog
        open={!!selectedFile}
        onClose={() => setSelectedFile(null)}
        title={selectedFile?.filename ?? ""}
        size="2xl"
      >
        {selectedFile && (
          <div className="flex items-center gap-2 mb-3 px-1">
            <span
              className={`text-[9px] px-1.5 py-0.5 rounded font-semibold ${
                selectedFile.source === "global"
                  ? "bg-violet-500/20 text-violet-300"
                  : "bg-surface text-dimmed"
              }`}
            >
              {selectedFile.source === "global" ? "~/.agents" : "repo"}
            </span>
          </div>
        )}
        <div className="flex-1 overflow-auto bg-app rounded border border-default p-4 font-mono text-xs whitespace-pre-wrap text-secondary max-h-[60vh]">
          {selectedFile?.content ?? ""}
        </div>
      </Dialog>
    </div>
  );
}
