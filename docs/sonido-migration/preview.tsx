import { createRoot } from "react-dom/client";
import { useState } from "react";
import "@juninmd/sonido/styles.css";
import "../../packages/web/src/index.css";
import "../../packages/web/src/features/remote-workspace/workspace.css";
import "../../packages/web/src/sonido-bridge.css";
import { Badge } from "../../packages/web/src/ui/Badge";
import { Button } from "../../packages/web/src/ui/Button";
import { EmptyState } from "../../packages/web/src/ui/EmptyState";
import { Kbd } from "../../packages/web/src/ui/Kbd";
import { Skeleton } from "../../packages/web/src/ui/Skeleton";
import { Spinner } from "../../packages/web/src/ui/Spinner";
import { Tabs } from "../../packages/web/src/ui/Tabs";
import { Icon } from "../../packages/web/src/features/remote-workspace/Icon";
import { applyTheme, themes } from "../../packages/web/src/theme/themes";
import LegacyBadge from "./legacy/Badge";
import LegacyButton from "./legacy/Button";
import LegacyEmptyState from "./legacy/EmptyState";
import LegacyKbd from "./legacy/Kbd";
import LegacyLoading from "./legacy/Loading";
import LegacySpinner from "./legacy/Spinner";
import LegacyTabs from "./legacy/Tabs";
import "./preview.css";

const THEME = new URLSearchParams(location.search).get("theme") === "light" ? "light" : "dark";
applyTheme(themes[THEME]);

const TABS = [
  { key: "general", label: "Interface" },
  { key: "projects", label: "Projetos" },
  { key: "harness", label: "Harnesses e modelos" },
  { key: "mcp", label: "MCP" },
];

function Row({
  title,
  hint,
  before,
  after,
}: {
  title: string;
  hint: string;
  before: React.ReactNode;
  after: React.ReactNode;
}) {
  return (
    <section className="preview-row">
      <div>
        <h2>{title}</h2>
        <p>{hint}</p>
      </div>
      <div className="preview-grid">
        <div className="preview-col preview-col--before legacy-col">
          <h3>Antes · componente do vibe-code</h3>
          <div className="preview-column">{before}</div>
        </div>
        <div className="preview-col preview-col--after">
          <h3>Depois · @juninmd/sonido</h3>
          <div className="preview-column">{after}</div>
        </div>
      </div>
    </section>
  );
}

function App() {
  const [legacyTab, setLegacyTab] = useState("general");
  const [sonidoTab, setSonidoTab] = useState("general");
  return (
    <div className="rw-root preview-root">
      <div className="preview-page">
        <header className="preview-header">
          <h1>vibe-code · primitivas locais trocadas pelo Sonido</h1>
          <p>
            Mesmo conteúdo e os mesmos tokens do app. À esquerda, o markup de origin/main; à
            direita, o componente que o app usa agora. Tema {THEME}.
          </p>
        </header>

        <Row
          title="Button"
          hint="Ações do workspace: primária, neutra e discreta, com ícone antes do rótulo."
          before={
            <div className="preview-stack">
              <LegacyButton variant="primary" icon={<Icon name="play" size={13} />}>
                Abrir terminal
              </LegacyButton>
              <LegacyButton variant="subtle" icon={<Icon name="copy" size={13} />}>
                Copiar saída
              </LegacyButton>
              <LegacyButton>Copiar comando</LegacyButton>
            </div>
          }
          after={
            <div className="preview-stack">
              <Button variant="primary" iconStart={<Icon name="play" size={13} />}>
                Abrir terminal
              </Button>
              <Button variant="subtle" iconStart={<Icon name="copy" size={13} />}>
                Copiar saída
              </Button>
              <Button>Copiar comando</Button>
            </div>
          }
        />

        <Row
          title="Tabs"
          hint="Seções de Configurações: rótulos curtos, foco itinerante e aria-selected."
          before={
            <LegacyTabs
              label="Seções de configurações"
              tabs={TABS}
              value={legacyTab}
              onChange={setLegacyTab}
            />
          }
          after={
            <Tabs
              label="Seções de configurações"
              tabs={TABS}
              value={sonidoTab}
              onChange={setSonidoTab}
            />
          }
        />

        <Row
          title="Badge"
          hint="Contagens de sessões, alterações e colunas do quadro."
          before={
            <div className="preview-stack">
              <LegacyBadge>12</LegacyBadge>
              <span className="rw-skill-chips">
                <span>revisar-pr</span>
                <span>testes-e2e</span>
              </span>
            </div>
          }
          after={
            <div className="preview-stack">
              <Badge>12</Badge>
              <span className="rw-skill-chips">
                <Badge>revisar-pr</Badge>
                <Badge>testes-e2e</Badge>
              </span>
            </div>
          }
        />

        <Row
          title="EmptyState"
          hint="Listas vazias de alterações, sessões, quadro e terminais."
          before={
            <LegacyEmptyState
              icon={<Icon name="code" size={28} />}
              title="Nenhuma alteração para revisar"
              description="Os arquivos aparecerão aqui quando houver um diff disponível."
            />
          }
          after={
            <EmptyState
              className="rw-empty-slot"
              icon={<Icon name="code" size={28} />}
              title="Nenhuma alteração para revisar"
              description="Os arquivos aparecerão aqui quando houver um diff disponível."
            />
          }
        />

        <Row
          title="Skeleton e Spinner"
          hint="Listas lentas mostravam só uma frase; a sessão em execução mostrava um ponto."
          before={
            <div className="preview-column">
              <LegacyLoading label="Carregando alterações…" />
              <LegacySpinner label="Sessão em execução no servidor" />
            </div>
          }
          after={
            <div className="preview-column">
              <Skeleton label="Carregando alterações." rows={3} />
              <div className="rw-thinking" role="status">
                <Spinner />
                Sessão em execução no servidor
              </div>
            </div>
          }
        />

        <Row
          title="Kbd"
          hint="Atalhos na lista de teclado."
          before={
            <div className="preview-kbd">
              <LegacyKbd>Ctrl</LegacyKbd> + <LegacyKbd>K</LegacyKbd>
            </div>
          }
          after={
            <div className="preview-kbd">
              <Kbd>Ctrl</Kbd> + <Kbd>K</Kbd>
            </div>
          }
        />
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
