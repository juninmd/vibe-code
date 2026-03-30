import type { PromptTemplate } from "@vibe-code/shared";
import { useState } from "react";
import { Button } from "./ui/button";
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
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
          <h2 className="text-sm font-semibold">Prompt Templates</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-zinc-500 hover:text-zinc-300 text-lg cursor-pointer"
          >
            &#x2715;
          </button>
        </div>

        {/* Search */}
        <div className="px-4 pt-3 pb-2">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar templates..."
            autoFocus
          />
        </div>

        {/* Template List */}
        <div className="flex-1 overflow-y-auto px-4 pb-3 space-y-4">
          {Object.keys(grouped).length === 0 && (
            <p className="text-center text-sm text-zinc-600 py-6">Nenhum template encontrado</p>
          )}
          {Object.entries(grouped).map(([cat, items]) => (
            <div key={cat}>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 mb-2">
                {CATEGORY_LABELS[cat] ?? cat}
              </p>
              <div className="space-y-1.5">
                {items.map((t) => (
                  <div
                    key={t.id}
                    className="group flex items-start gap-3 p-3 rounded-lg bg-zinc-800/60 hover:bg-zinc-800 cursor-pointer transition-colors"
                    onClick={() => onSelect(t)}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-zinc-100">{t.title}</span>
                        {t.category && (
                          <span
                            className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${CATEGORY_COLORS[t.category] ?? "bg-zinc-700 text-zinc-400"}`}
                          >
                            {CATEGORY_LABELS[t.category] ?? t.category}
                          </span>
                        )}
                        {t.isBuiltin && <span className="text-[10px] text-zinc-600">built-in</span>}
                      </div>
                      {t.description && (
                        <p className="text-xs text-zinc-500 mt-0.5 line-clamp-2">{t.description}</p>
                      )}
                    </div>
                    {!t.isBuiltin && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(t.id);
                        }}
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
        <div className="border-t border-zinc-800 px-4 py-3">
          {showSaveForm ? (
            <div className="space-y-2">
              <p className="text-xs text-zinc-400">Salvar prompt atual como template:</p>
              <Input
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="Nome do template"
                autoFocus
              />
              <select
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-md px-3 py-1.5 text-sm text-zinc-200 focus:outline-none focus:ring-1 focus:ring-violet-500"
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
                  Cancelar
                </Button>
              </div>
            </div>
          ) : (
            <Button
              variant="outline"
              className="w-full text-xs"
              disabled={!currentContent.trim()}
              onClick={() => setShowSaveForm(true)}
            >
              + Salvar prompt atual como template
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
