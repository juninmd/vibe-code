import type {
  AgentEntry,
  RuleEntry,
  SkillEntry,
  SkillsIndex,
  WorkflowEntry,
} from "@vibe-code/shared";
import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import { Badge } from "./ui/badge";
import { Dialog } from "./ui/dialog";

type Tab = "loaded" | "skills" | "rules" | "agents" | "workflows" | "market";
type AnyEntry = RuleEntry | SkillEntry | AgentEntry | WorkflowEntry;

const categoryMeta: Record<string, { color: string; bg: string; label: string }> = {
  rule: { color: "#f59e0b", bg: "rgba(245,158,11,0.15)", label: "Rule" },
  skill: { color: "#8b5cf6", bg: "rgba(139,92,246,0.15)", label: "Skill" },
  agent: { color: "#3b82f6", bg: "rgba(59,130,246,0.15)", label: "Agent" },
  workflow: { color: "#10b981", bg: "rgba(16,185,129,0.15)", label: "Workflow" },
};

function SkillCard({
  entry,
  isSelected,
  onSelect,
}: {
  entry: AnyEntry & { _category?: string };
  isSelected: boolean;
  onSelect: () => void;
}) {
  const cat = entry._category || "skill";
  const meta = categoryMeta[cat];

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full text-left p-4 rounded-2xl border transition-all active-shrink cursor-pointer group ${
        isSelected
          ? "bg-accent/10 border-accent shadow-lg shadow-accent/10"
          : "bg-surface/30 border-white/5 hover:border-white/10 hover:bg-surface/50"
      }`}
    >
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex items-center gap-2">
          <div
            className="w-2 h-2 rounded-full shadow-[0_0_8px_currentColor]"
            style={{ backgroundColor: meta.color, color: meta.color }}
          />
          <span
            className="text-[10px] font-black uppercase tracking-widest opacity-70"
            style={{ color: meta.color }}
          >
            {meta.label}
          </span>
        </div>
        {isSelected && (
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
      <h4 className="text-sm font-black tracking-tight text-primary truncate group-hover:text-accent transition-colors">
        {entry.name}
      </h4>
      <p className="text-[11px] text-muted line-clamp-2 mt-1 leading-relaxed">
        {entry.description}
      </p>
    </button>
  );
}

export function SkillsBrowser({
  open,
  onClose,
  initialSkillName,
  matchedSkills = [],
}: {
  open: boolean;
  onClose: () => void;
  initialSkillName?: string;
  matchedSkills?: string[];
}) {
  const [index, setIndex] = useState<SkillsIndex | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>(matchedSkills.length > 0 ? "loaded" : "skills");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    api.skills
      .index()
      .then(setIndex)
      .finally(() => setLoading(false));
  }, [open]);

  useEffect(() => {
    if (initialSkillName) {
      setSelectedId(initialSkillName);
      if (matchedSkills.includes(initialSkillName)) setActiveTab("loaded");
    }
  }, [initialSkillName, matchedSkills]);

  const allEntries = useMemo(() => {
    if (!index) return [];
    if (activeTab === "loaded") {
      const loaded: (AnyEntry & { _category: string })[] = [];
      for (const raw of matchedSkills) {
        const [cat, name] = raw.includes(":") ? raw.split(":") : ["skill", raw];
        const entry = (index as any)[
          cat === "rule"
            ? "rules"
            : cat === "agent"
              ? "agents"
              : cat === "workflow"
                ? "workflows"
                : "skills"
        ]?.find((e: any) => e.name === name);
        if (entry) loaded.push({ ...entry, _category: cat });
      }
      return loaded;
    }
    const cat =
      activeTab === "rules"
        ? "rules"
        : activeTab === "agents"
          ? "agents"
          : activeTab === "workflows"
            ? "workflows"
            : "skills";
    const entries = (index[cat as keyof SkillsIndex] || []) as AnyEntry[];
    return entries.map((e) => ({ ...e, _category: cat.slice(0, -1) }));
  }, [index, activeTab, matchedSkills]);

  const selectedEntry = useMemo(() => {
    return allEntries.find((e) => e.name === selectedId) || allEntries[0];
  }, [allEntries, selectedId]);

  return (
    <Dialog open={open} onClose={onClose} title="Intelligence Registry" size="5xl">
      <div className="flex h-[75vh] -mx-8 -mb-8 mt-4 overflow-hidden border-t border-white/5 bg-black/20">
        {/* Modern Sidebar Nav */}
        <div className="w-64 shrink-0 border-r border-white/5 flex flex-col">
          <div className="p-4 space-y-1">
            {(["loaded", "skills", "rules", "agents", "workflows"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setActiveTab(t)}
                className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-[11px] font-black uppercase tracking-widest transition-all active-shrink cursor-pointer ${
                  activeTab === t
                    ? "bg-accent text-white shadow-lg shadow-accent/25"
                    : "text-muted hover:text-primary hover:bg-white/5"
                }`}
              >
                {t}
                {t === "loaded" && matchedSkills.length > 0 && (
                  <span className="ml-auto bg-white/20 px-1.5 rounded-md text-[9px]">
                    {matchedSkills.length}
                  </span>
                )}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto p-4 pt-0 space-y-2 custom-scrollbar">
            <div className="h-px bg-white/5 mb-4" />
            {loading ? (
              <div className="space-y-2 animate-pulse">
                {[1, 2, 3, 4, 5].map((i) => (
                  <div key={i} className="h-16 rounded-2xl bg-white/5" />
                ))}
              </div>
            ) : (
              allEntries.map((e) => (
                <SkillCard
                  key={e.name}
                  entry={e}
                  isSelected={selectedId === e.name}
                  onSelect={() => setSelectedId(e.name)}
                />
              ))
            )}
          </div>
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto p-10 custom-scrollbar bg-black/10">
          {selectedEntry ? (
            <div className="max-w-3xl animate-in fade-in slide-in-from-right-4 duration-500">
              <div className="flex items-center gap-3 mb-4">
                <Badge
                  className="font-black uppercase tracking-widest rounded-lg"
                  style={{
                    backgroundColor: categoryMeta[selectedEntry._category || "skill"].bg,
                    color: categoryMeta[selectedEntry._category || "skill"].color,
                  }}
                >
                  {categoryMeta[selectedEntry._category || "skill"].label}
                </Badge>
                <h2 className="text-3xl font-black tracking-tight text-primary">
                  {selectedEntry.name}
                </h2>
              </div>
              <p className="text-lg text-secondary leading-relaxed mb-8 text-balance">
                {selectedEntry.description}
              </p>

              <div className="h-px bg-white/5 mb-8" />

              <div className="space-y-10">
                {(selectedEntry as any).instructions && (
                  <section>
                    <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-accent mb-4">
                      Core Instructions
                    </h3>
                    <div className="p-6 rounded-[2rem] bg-white/[0.02] border border-white/5 text-sm text-secondary leading-relaxed font-mono whitespace-pre-wrap">
                      {(selectedEntry as any).instructions}
                    </div>
                  </section>
                )}

                {/* Capabilities/Params */}
                <div className="grid md:grid-cols-2 gap-8">
                  {(selectedEntry as any).capabilities && (
                    <section>
                      <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-accent mb-4">
                        Capabilities
                      </h3>
                      <div className="flex flex-wrap gap-2">
                        {((selectedEntry as any).capabilities as string[]).map((c: string) => (
                          <span
                            key={c}
                            className="px-3 py-1 rounded-full bg-white/5 border border-white/5 text-[11px] font-bold text-primary"
                          >
                            {c}
                          </span>
                        ))}
                      </div>
                    </section>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="h-full flex flex-col items-center justify-center opacity-30 text-center space-y-4">
              <p className="text-6xl">✦</p>
              <p className="text-xs font-black uppercase tracking-widest">
                Select an intelligence module
              </p>
            </div>
          )}
        </div>
      </div>
    </Dialog>
  );
}
