interface ShortcutsModalProps {
  onClose: () => void;
}

const SHORTCUTS = [
  { keys: ["N"], description: "Nova tarefa" },
  { keys: ["D"], description: "Duplicar task selecionada" },
  { keys: ["Del"], description: "Deletar task selecionada" },
  { keys: ["Ctrl", "Shift", "O"], description: "Adicionar repositório" },
  { keys: ["Ctrl", "O"], description: "Abrir no editor" },
  { keys: ["Ctrl", "1-9"], description: "Mudar repositório (workspace)" },
  { keys: ["Ctrl", "K"], description: "Command palette" },
  { keys: ["Ctrl", "S"], description: "Exportar board" },
  { keys: ["Ctrl", "Shift", "C"], description: "Limpar busca" },
  { keys: ["Ctrl", "D"], description: "Dividir terminal à direita" },
  { keys: ["Ctrl", "Shift", "D"], description: "Dividir terminal abaixo" },
  { keys: ["?"], description: "Mostrar atalhos" },
  { keys: ["Esc"], description: "Fechar painel/diálogo" },
];

export function ShortcutsModal({ onClose }: ShortcutsModalProps) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      <button
        type="button"
        aria-label="Fechar modal de atalhos"
        className="absolute inset-0 bg-black/60 backdrop-blur-[2px]"
        onClick={onClose}
      />
      <div className="relative glass-panel border rounded-xl shadow-2xl shadow-black/40 w-full max-w-sm mx-4 p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-primary">Atalhos de teclado</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-primary0 hover:text-secondary cursor-pointer p-1 rounded hover:bg-surface-hover transition-colors"
          >
            ✕
          </button>
        </div>

        <table className="w-full text-xs">
          <tbody className="divide-y divide-zinc-800/60">
            {SHORTCUTS.map(({ keys, description }) => (
              <tr key={description} className="py-1">
                <td className="py-1.5 pr-4">
                  <div className="flex items-center gap-1">
                    {keys.map((k) => (
                      <kbd
                        key={k}
                        className="inline-flex items-center justify-center px-1.5 py-0.5 rounded border border-strong bg-surface text-secondary font-mono text-[10px] min-w-[22px]"
                      >
                        {k}
                      </kbd>
                    ))}
                  </div>
                </td>
                <td className="py-1.5 text-secondary">{description}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
