import { CommandPalette as SonidoCommandPalette } from "@juninmd/sonido";
import { Kbd } from "../../ui/Kbd";
import { type Command, filterCommands, formatShortcut } from "./commands";

/**
 * The palette itself is Sonido's: search box, groups, arrow keys and `aria-activedescendant`.
 * The app keeps its command registry, so `filterCommands` still decides what a query finds.
 */
export function CommandPalette({
  commands,
  onClose,
}: {
  commands: Command[];
  onClose: () => void;
}) {
  return (
    <SonidoCommandPalette
      open
      onClose={onClose}
      label="Buscar comandos e sessões"
      placeholder="Buscar comandos e sessões."
      emptyText={(query) => `Nada encontrado para "${query}".`}
      commands={(query) =>
        filterCommands(commands, query).map((command) => ({
          id: command.id,
          label: command.title,
          group: command.section,
          hint: command.shortcut ? formatShortcut(command.shortcut) : undefined,
          keywords: command.keywords,
          run: command.run,
        }))
      }
    />
  );
}

export function ShortcutList({ items }: { items: [string, string][] }) {
  return (
    <dl className="rw-shortcut-list">
      {items.map(([label, shortcut]) => (
        <div key={shortcut}>
          <dt>{label}</dt>
          <dd>
            <Kbd>{formatShortcut(shortcut)}</Kbd>
          </dd>
        </div>
      ))}
    </dl>
  );
}
