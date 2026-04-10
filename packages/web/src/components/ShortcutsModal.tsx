interface ShortcutsModalProps {
  onClose: () => void;
}

const SHORTCUTS = [
  { keys: ["N"], description: "Nova tarefa" },
  { keys: ["Ctrl", "O"], description: "Adicionar repositório" },
  { keys: ["Ctrl", "K"], description: "Command palette" },
  { keys: ["?"], description: "Mostrar atalhos" },
  { keys: ["F"], description: "Abrir/fechar filtros" },
  { keys: ["E"], description: "Painel de engines" },
  { keys: ["/"], description: "Focar busca" },
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
          <h2 className="text-sm font-semibold text-zinc-200">Atalhos de teclado</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-zinc-500 hover:text-zinc-300 cursor-pointer p-1 rounded hover:bg-zinc-800 transition-colors"
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
                        className="inline-flex items-center justify-center px-1.5 py-0.5 rounded border border-zinc-600 bg-zinc-800 text-zinc-300 font-mono text-[10px] min-w-[22px]"
                      >
                        {k}
                      </kbd>
                    ))}
                  </div>
                </td>
                <td className="py-1.5 text-zinc-400">{description}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
