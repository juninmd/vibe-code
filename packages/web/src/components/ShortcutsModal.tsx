import { Dialog } from "./ui/dialog";

const SHORTCUTS = [
  { keys: ["N"], description: "New task" },
  { keys: ["D"], description: "Duplicate selected task" },
  { keys: ["Del"], description: "Delete selected task" },
  { keys: ["Ctrl", "Shift", "O"], description: "Add repository" },
  { keys: ["Ctrl", "O"], description: "Open in editor" },
  { keys: ["Ctrl", "1-9"], description: "Switch repository (workspace)" },
  { keys: ["Ctrl", "K"], description: "Command palette" },
  { keys: ["Ctrl", "S"], description: "Export board" },
  { keys: ["Ctrl", "Shift", "C"], description: "Clear search" },
  { keys: ["Ctrl", "D"], description: "Split terminal right" },
  { keys: ["Ctrl", "Shift", "D"], description: "Split terminal down" },
  { keys: ["?"], description: "Show shortcuts" },
  { keys: ["Esc"], description: "Close active panel" },
];

export function ShortcutsModal({ onClose }: { onClose: () => void }) {
  return (
    <Dialog open onClose={onClose} title="Neural Interface Bindings" size="md">
      <div className="space-y-6">
        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-dimmed ml-1">
          Keyboard Command Reference
        </p>
        <div className="rounded-[1.5rem] border border-white/5 bg-white/[0.02] overflow-hidden">
          <table className="w-full text-xs">
            <tbody className="divide-y divide-white/5">
              {SHORTCUTS.map(({ keys, description }) => (
                <tr key={description} className="hover:bg-white/[0.02] transition-colors group">
                  <td className="py-4 pl-6 pr-4">
                    <div className="flex items-center gap-1.5">
                      {keys.map((k) => (
                        <kbd
                          key={k}
                          className="inline-flex items-center justify-center px-2 py-1 rounded-lg border border-white/10 bg-white/5 text-primary font-black font-mono text-[9px] min-w-[24px] shadow-sm group-hover:border-accent/40 transition-colors"
                        >
                          {k}
                        </kbd>
                      ))}
                    </div>
                  </td>
                  <td className="py-4 pr-6 text-secondary font-bold tracking-tight">
                    {description}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Dialog>
  );
}
