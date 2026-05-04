import type { PromptTemplate } from "@vibe-code/shared";
import type React from "react";
import { useState } from "react";
import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";
import { Input } from "./ui/input";
import { Select } from "./ui/select";

interface PromptTemplatePickerProps {
  templates: PromptTemplate[];
  currentContent: string;
  onSelect: (template: PromptTemplate) => void;
  onClose: () => void;
  onSaveNew: (data: { title: string; content: string; category?: string }) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

const CATEGORY_LABELS: Record<string, string> = {
  docs: "Documentation",
  security: "Security",
  perf: "Performance",
  ui: "Interface",
  code: "Core Logic",
};

const CATEGORY_COLORS: Record<string, string> = {
  docs: "border-blue-500/30 bg-blue-500/10 text-blue-400",
  security: "border-red-500/30 bg-red-500/10 text-red-400",
  perf: "border-amber-500/30 bg-amber-500/10 text-amber-400",
  ui: "border-purple-500/30 bg-purple-500/10 text-purple-400",
  code: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
};

export function PromptTemplatePicker({
  templates,
  currentContent,
  onSelect,
  onClose,
  onSaveNew,
  onDelete,
}: PromptTemplatePickerProps) {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<PromptTemplate | null>(null);
  const [showSaveForm, setShowSaveForm] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newCategory, setNewCategory] = useState("code");
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const safeTemplates = templates ?? [];
  const filtered = search
    ? safeTemplates.filter(
        (t) =>
          t.title.toLowerCase().includes(search.toLowerCase()) ||
          t.description?.toLowerCase().includes(search.toLowerCase()) ||
          t.category?.toLowerCase().includes(search.toLowerCase())
      )
    : safeTemplates;

  const grouped = filtered.reduce<Record<string, PromptTemplate[]>>((acc, t) => {
    const cat = t.category ?? "other";
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(t);
    return acc;
  }, {});

  const handleSave = async () => {
    if (!newTitle.trim() || !currentContent.trim()) return;
    setSaving(true);
    try {
      await onSaveNew({
        title: newTitle.trim(),
        content: currentContent.trim(),
        category: newCategory,
      });
      setShowSaveForm(false);
      setNewTitle("");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    try {
      await onDelete(id);
      if (selected?.id === id) setSelected(null);
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <Dialog open onClose={onClose} title="Operational Blueprint Library" size="5xl">
      <div className="flex gap-8 h-[68vh] -mx-4 -mb-4 border-t border-white/5 pt-6">
        {/* Left panel: list */}
        <div className="flex flex-col w-80 shrink-0 gap-4">
          <div className="relative group">
            <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none text-muted group-focus-within:text-accent transition-colors">
              <svg
                width="12"
                height="12"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <title>Search Icon</title>
                <circle cx="7" cy="7" r="5" />
                <path d="M11 11l4 4" />
              </svg>
            </div>
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search blueprints..."
              className="pl-9 h-10 rounded-xl bg-input/40 border-white/5 focus:border-accent/40"
              autoFocus
            />
          </div>

          <div className="flex-1 overflow-y-auto space-y-6 pr-2 custom-scrollbar">
            {Object.keys(grouped).length === 0 && (
              <div className="py-20 text-center opacity-30 space-y-2">
                <p className="text-3xl">∅</p>
                <p className="text-[10px] font-black uppercase tracking-widest">Library Empty</p>
              </div>
            )}
            {Object.entries(grouped).map(([cat, items]) => (
              <div key={cat} className="space-y-2">
                <p className="text-[9px] font-black uppercase tracking-[0.2em] text-accent/80 ml-2">
                  {CATEGORY_LABELS[cat] ?? cat}
                </p>
                <div className="space-y-1.5">
                  {items.map((t) => (
                    <div key={t.id} className="group relative">
                      <button
                        type="button"
                        onClick={() => setSelected(t)}
                        className={`w-full text-left p-4 rounded-2xl border transition-all active-shrink cursor-pointer ${
                          selected?.id === t.id
                            ? "bg-accent/10 border-accent shadow-lg shadow-accent/10"
                            : "bg-surface/30 border-white/5 hover:border-white/10"
                        }`}
                      >
                        <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                          <span className="text-sm font-black tracking-tight text-primary truncate flex-1">
                            {t.title}
                          </span>
                          {t.isBuiltin && (
                            <span className="text-[8px] font-black uppercase tracking-widest text-dimmed bg-white/5 px-1.5 rounded border border-white/5">
                              Built-in
                            </span>
                          )}
                        </div>
                        {t.category && (
                          <span
                            className={`inline-block text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-md border ${CATEGORY_COLORS[t.category] ?? "border-white/10 bg-white/5 text-muted"}`}
                          >
                            {CATEGORY_LABELS[t.category] ?? t.category}
                          </span>
                        )}
                        {t.description && (
                          <p className="text-[10px] text-muted mt-2 line-clamp-1 opacity-70 group-hover:opacity-100">
                            {t.description}
                          </p>
                        )}
                      </button>
                      {!t.isBuiltin && (
                        <button
                          type="button"
                          onClick={() => handleDelete(t.id)}
                          disabled={deletingId === t.id}
                          className="absolute -top-1.5 -right-1.5 w-6 h-6 rounded-full bg-danger text-white flex items-center justify-center shadow-lg opacity-0 group-hover:opacity-100 transition-all cursor-pointer border-2 border-app z-10"
                          title="Purge Blueprint"
                        >
                          <svg
                            width="10"
                            height="10"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="4"
                          >
                            <title>Purge Icon</title>
                            <path d="M18 6L6 18M6 6l12 12" />
                          </svg>
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Persistent storage action */}
          <div className="border-t border-white/5 pt-4 bg-white/[0.01] -mx-4 px-4 pb-4">
            {showSaveForm ? (
              <div className="space-y-4 animate-in slide-in-from-bottom-2 duration-300">
                <p className="text-[10px] font-black uppercase tracking-widest text-accent">
                  Commit current context
                </p>
                <div className="space-y-2">
                  <Input
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                    placeholder="Blueprint identifier..."
                    className="h-9 rounded-xl bg-input/40 text-xs"
                  />
                  <Select
                    value={newCategory}
                    onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
                      setNewCategory(e.target.value)
                    }
                    className="h-9 rounded-xl bg-input/40 text-xs font-bold"
                  >
                    {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="primary"
                    disabled={!newTitle.trim() || !currentContent.trim() || saving}
                    onClick={handleSave}
                    className="flex-1 rounded-xl h-10 shadow-lg shadow-accent/20 font-black uppercase tracking-widest text-[9px]"
                  >
                    {saving ? "Persisting..." : "Save Blueprint"}
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => setShowSaveForm(false)}
                    className="rounded-xl px-3"
                  >
                    ✕
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                variant="ghost"
                className="w-full h-11 rounded-2xl border-dashed border-white/10 hover:bg-accent/5 hover:border-accent/40 text-[10px] font-black uppercase tracking-widest"
                disabled={!currentContent.trim()}
                onClick={() => setShowSaveForm(true)}
              >
                + Persist Current Prompt
              </Button>
            )}
          </div>
        </div>

        {/* Right panel: dynamic preview */}
        <div className="flex-1 flex flex-col min-w-0 bg-black/20 rounded-[2rem] border border-white/5 overflow-hidden">
          {!selected ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-4 opacity-30 text-center px-10">
              <p className="text-6xl">✦</p>
              <div className="space-y-1">
                <p className="text-sm font-black tracking-tight text-primary">Preview Module</p>
                <p className="text-[10px] font-black uppercase tracking-widest">
                  Select a blueprint from the library to analyze its neural weights
                </p>
              </div>
            </div>
          ) : (
            <div className="flex flex-col h-full animate-in fade-in duration-500">
              <div className="p-8 border-b border-white/5 flex items-center justify-between gap-6 bg-white/[0.02]">
                <div className="min-w-0">
                  <h3 className="text-xl font-black tracking-tight text-primary truncate">
                    {selected.title}
                  </h3>
                  {selected.description && (
                    <p className="text-xs text-muted mt-1 leading-relaxed line-clamp-2">
                      {selected.description}
                    </p>
                  )}
                </div>
                <Button
                  variant="primary"
                  onClick={() => {
                    onSelect(selected);
                    onClose();
                  }}
                  className="shrink-0 h-11 px-8 rounded-2xl shadow-xl shadow-accent/30 font-black uppercase tracking-widest text-[10px] min-w-[160px]"
                >
                  Deploy Module
                </Button>
              </div>

              <div className="flex-1 overflow-hidden flex flex-col p-8">
                <div className="flex items-center gap-2 mb-3">
                  <div className="h-px flex-1 bg-white/5" />
                  <span className="text-[9px] font-black uppercase tracking-[0.2em] text-dimmed">
                    Raw Configuration
                  </span>
                  <div className="h-px flex-1 bg-white/5" />
                </div>
                <div className="flex-1 overflow-y-auto rounded-[1.5rem] border border-white/5 bg-black/40 p-6 custom-scrollbar">
                  <pre className="text-xs font-mono whitespace-pre-wrap leading-relaxed text-secondary selection:bg-accent/30">
                    {selected.content}
                  </pre>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </Dialog>
  );
}
