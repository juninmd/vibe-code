import type { PromptTemplate } from "@vibe-code/shared";
import { useState } from "react";
import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";
import { Input } from "./ui/input";

interface PromptTemplatePickerProps {
  templates: PromptTemplate[];
  currentContent: string;
  onSelect: (template: PromptTemplate) => void;
  onClose: () => void;
  onSaveNew: (data: { title: string; content: string; category?: string }) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

const CATEGORY_LABELS: Record<string, string> = {
  docs: "Documentação",
  security: "Segurança",
  perf: "Performance",
  ui: "Interface",
  code: "Código",
};

const CATEGORY_COLORS: Record<string, string> = {
  docs: "bg-blue-500/20 text-blue-300",
  security: "bg-red-500/20 text-red-300",
  perf: "bg-yellow-500/20 text-yellow-300",
  ui: "bg-purple-500/20 text-purple-300",
  code: "bg-green-500/20 text-green-300",
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

  // Group by category
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
    <Dialog open onClose={onClose} title="Prompt Templates" size="5xl">
      <div className="flex gap-4 h-[65vh] -mx-1">
        {/* Left panel: list */}
        <div className="flex flex-col w-72 shrink-0 gap-2">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar templates..."
            autoFocus
          />

          <div className="flex-1 overflow-y-auto space-y-3 pr-1">
            {Object.keys(grouped).length === 0 && (
              <p className="text-center text-xs text-zinc-600 py-6">Nenhum template encontrado</p>
            )}
            {Object.entries(grouped).map(([cat, items]) => (
              <div key={cat}>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 mb-1.5 px-1">
                  {CATEGORY_LABELS[cat] ?? cat}
                </p>
                <div className="space-y-1">
                  {items.map((t) => (
                    <div key={t.id} className="group flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setSelected(t)}
                        className="flex-1 min-w-0 px-2.5 py-2 rounded-lg border text-left cursor-pointer transition-colors"
                        style={{
                          background:
                            selected?.id === t.id
                              ? "var(--accent-muted, rgba(139,92,246,0.15))"
                              : "var(--bg-card)",
                          borderColor:
                            selected?.id === t.id ? "var(--accent)" : "var(--glass-border)",
                        }}
                      >
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-xs font-medium truncate text-zinc-100">
                            {t.title}
                          </span>
                          {t.category && (
                            <span
                              className={`text-[9px] px-1 py-0.5 rounded font-medium shrink-0 ${CATEGORY_COLORS[t.category] ?? "bg-zinc-700 text-zinc-400"}`}
                            >
                              {CATEGORY_LABELS[t.category] ?? t.category}
                            </span>
                          )}
                          {t.isBuiltin && (
                            <span className="text-[9px] text-zinc-600 shrink-0">built-in</span>
                          )}
                        </div>
                        {t.description && (
                          <p className="text-[10px] text-zinc-500 mt-0.5 line-clamp-1">
                            {t.description}
                          </p>
                        )}
                      </button>
                      {!t.isBuiltin && (
                        <button
                          type="button"
                          onClick={() => handleDelete(t.id)}
                          disabled={deletingId === t.id}
                          className="opacity-0 group-hover:opacity-100 shrink-0 text-zinc-600 hover:text-red-400 transition-all cursor-pointer p-1"
                          title="Remover template"
                        >
                          {deletingId === t.id ? "..." : "✕"}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Save current as template */}
          <div className="border-t pt-2" style={{ borderColor: "var(--glass-border)" }}>
            {showSaveForm ? (
              <div className="space-y-2">
                <p className="text-[10px] text-zinc-500">Salvar prompt atual como template:</p>
                <Input
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="Nome do template"
                />
                <select
                  value={newCategory}
                  onChange={(e) => setNewCategory(e.target.value)}
                  className="w-full rounded-md px-2.5 py-1.5 text-xs focus:outline-none"
                  style={{
                    background: "var(--bg-input)",
                    border: "1px solid var(--glass-border)",
                    color: "var(--text-primary)",
                  }}
                >
                  {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
                <div className="flex gap-2">
                  <Button
                    variant="primary"
                    disabled={!newTitle.trim() || !currentContent.trim() || saving}
                    onClick={handleSave}
                    className="flex-1"
                  >
                    {saving ? "Salvando..." : "Salvar"}
                  </Button>
                  <Button variant="ghost" onClick={() => setShowSaveForm(false)}>
                    ✕
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                variant="ghost"
                className="w-full text-xs"
                disabled={!currentContent.trim()}
                onClick={() => setShowSaveForm(true)}
              >
                + Salvar como template
              </Button>
            )}
          </div>
        </div>

        {/* Divider */}
        <div className="w-px shrink-0 self-stretch" style={{ background: "var(--glass-border)" }} />

        {/* Right panel: preview */}
        <div className="flex-1 flex flex-col gap-3 min-w-0">
          {!selected ? (
            <div className="flex-1 flex items-center justify-center">
              <p className="text-sm" style={{ color: "var(--text-dimmed)" }}>
                ← Selecione um template para visualizar
              </p>
            </div>
          ) : (
            <>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-zinc-100">{selected.title}</h3>
                  {selected.description && (
                    <p className="text-xs mt-0.5 text-zinc-500">{selected.description}</p>
                  )}
                </div>
                <Button
                  variant="primary"
                  onClick={() => {
                    onSelect(selected);
                    onClose();
                  }}
                  className="shrink-0"
                >
                  Usar este prompt
                </Button>
              </div>

              <div
                className="flex-1 overflow-y-auto rounded-lg border p-3"
                style={{
                  background: "var(--bg-card)",
                  borderColor: "var(--glass-border)",
                }}
              >
                <pre
                  className="text-xs font-mono whitespace-pre-wrap leading-relaxed"
                  style={{ color: "var(--text-secondary)" }}
                >
                  {selected.content}
                </pre>
              </div>
            </>
          )}
        </div>
      </div>
    </Dialog>
  );
}
