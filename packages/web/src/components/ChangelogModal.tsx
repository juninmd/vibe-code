import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api } from "../api/client";
import { Dialog } from "./ui/dialog";

export function ChangelogModal({ onClose }: { onClose: () => void }) {
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.changelog
      .get()
      .then((res) => {
        setContent(res.content);
        setLoading(false);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });
  }, []);

  return (
    <Dialog open onClose={onClose} title="Version Evolution" size="xl">
      <div className="flex flex-col max-h-[70vh]">
        <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-20 gap-4 opacity-50 animate-pulse">
              <div className="w-12 h-12 border-4 border-accent/20 border-t-accent rounded-full animate-spin" />
              <p className="text-[10px] font-black uppercase tracking-[0.3em]">
                Decoding system logs...
              </p>
            </div>
          ) : error ? (
            <div className="p-8 rounded-[2rem] bg-danger/10 border border-danger/20 text-center space-y-3">
              <p className="text-sm font-bold text-danger">Deployment History Offline</p>
              <p className="text-xs text-muted leading-relaxed">{error}</p>
            </div>
          ) : (
            <div className="prose prose-sm prose-invert max-w-none prose-headings:font-black prose-headings:tracking-tight prose-headings:text-primary prose-p:text-secondary prose-li:text-secondary">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {content || "No records found in the current environment."}
              </ReactMarkdown>
            </div>
          )}
        </div>
      </div>
    </Dialog>
  );
}
