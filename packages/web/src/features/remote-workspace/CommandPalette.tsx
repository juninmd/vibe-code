import { useState } from "react";
import { type Command, filterCommands, formatShortcut } from "./commands";
import { Icon } from "./Icon";

export function CommandPalette({ commands }: { commands: Command[] }) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const results = filterCommands(commands, query);
  const current = Math.min(active, Math.max(results.length - 1, 0));
  const run = (command: Command | undefined) => command?.run();
  return (
    <>
      <label className="rw-search rw-dialog-search">
        <Icon name="search" />
        <input
          data-autofocus
          role="combobox"
          aria-expanded="true"
          aria-controls="rw-command-results"
          aria-activedescendant={results[current] ? `rw-cmd-${results[current].id}` : undefined}
          aria-label="Buscar comandos e sessões"
          placeholder="Buscar comandos e sessões…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              const step = e.key === "ArrowDown" ? 1 : -1;
              setActive((current + step + results.length) % Math.max(results.length, 1));
            } else if (e.key === "Enter") {
              e.preventDefault();
              run(results[current]);
            }
          }}
        />
      </label>
      <div id="rw-command-results" role="listbox" className="rw-command-list" aria-label="Comandos">
        {results.map((command, index) => {
          const header = !query && command.section !== results[index - 1]?.section;
          return (
            <div key={command.id} role="presentation">
              {header && <p className="rw-command-section">{command.section}</p>}
              <button
                type="button"
                role="option"
                id={`rw-cmd-${command.id}`}
                aria-selected={index === current}
                className={index === current ? "active" : undefined}
                tabIndex={-1}
                onMouseMove={() => setActive(index)}
                onClick={() => run(command)}
              >
                <span>{command.title}</span>
                {command.shortcut && <kbd>{formatShortcut(command.shortcut)}</kbd>}
              </button>
            </div>
          );
        })}
        {!results.length && <p className="rw-inline-state">Nada encontrado para “{query}”.</p>}
      </div>
    </>
  );
}

export function ShortcutList({ items }: { items: [string, string][] }) {
  return (
    <dl className="rw-shortcut-list">
      {items.map(([label, shortcut]) => (
        <div key={shortcut}>
          <dt>{label}</dt>
          <dd>
            <kbd>{formatShortcut(shortcut)}</kbd>
          </dd>
        </div>
      ))}
    </dl>
  );
}
