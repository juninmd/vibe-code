import { expect, test, type APIRequestContext } from "@playwright/test";
import { E2E } from "../playwright.config";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

async function fixtureRepo(request: APIRequestContext) {
  let repo = (await (await request.get("/api/repos")).json()).data.find((entry: { url: string }) => entry.url === E2E.fixtureRepo);
  if (!repo) {
    const added = await request.post("/api/repos", { data: { url: E2E.fixtureRepo } });
    expect(added.ok()).toBe(true);
    repo = (await added.json()).data;
  }
  await expect.poll(async () => (await (await request.get(`/api/repos/${repo.id}`)).json()).data.status).toBe("ready");
  return repo;
}

test.describe("Unified remote prototype", () => {
  test("keeps conversation, terminal and changes in one session", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setViewportSize({ width: 1520, height: 1000 });
    await page.goto("/prototype?demo=1");
    await expect(page.getByRole("heading", { name: "Unificar a experiência remota" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Demonstração", exact: true })).toBeVisible();
    await page.screenshot({ path: "test-results/unified-prototype/conversation.png", fullPage: true });
    await page.getByRole("tab", { name: "Terminal", exact: true }).click();
    await page.getByRole("textbox", { name: "Comando de demonstração" }).fill("git status");
    await page.getByRole("textbox", { name: "Comando de demonstração" }).press("Enter");
    await expect(page.getByRole("region", { name: "Saída do terminal" })).toContainText("feat/unified-workspace");
    await page.screenshot({ path: "test-results/unified-prototype/terminal.png", fullPage: true });
    await page.getByRole("tab", { name: /Alterações/ }).click();
    await page.getByRole("navigation", { name: "Arquivos alterados" }).getByRole("button", { name: /SessionTabs/ }).click();
    await expect(page.getByRole("region", { name: "Diff do arquivo" })).toContainText("export function SessionTabs");
    await page.screenshot({ path: "test-results/unified-prototype/changes.png", fullPage: true });
    await page.getByRole("tab", { name: "Terminal", exact: true }).click();
    await expect(page.getByRole("region", { name: "Saída do terminal" })).toContainText("$ git status");
    await page.getByRole("tab", { name: "Conversa", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Unificar a experiência remota" })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("creates a demonstration session in a selected project and retains its conversation", async ({ page }) => {
    await page.goto("/prototype?demo=1");
    await page.getByRole("button", { name: "Escolher projeto", exact: true }).click();
    await page.getByRole("textbox", { name: "Buscar repositórios" }).fill("design-system");
    await page.getByRole("button", { name: /studio\/design-system/ }).click();
    await expect(page.getByRole("heading", { name: "O que vamos construir?" })).toBeVisible();
    await page.screenshot({ path: "test-results/unified-prototype/new-session.png", fullPage: true });
    const prompt = "Planejar uma melhoria de acessibilidade";
    await page.getByRole("textbox", { name: "Mensagem para o agente" }).fill(prompt);
    await page.getByRole("button", { name: "Enviar mensagem", exact: true }).click();
    await expect(page.getByRole("heading", { name: prompt })).toBeVisible();
    await expect(page.getByRole("complementary", { name: "Contexto da sessão", exact: true })).toContainText("develop");
    await expect(page.getByText("Vamos trabalhar nessa ideia.", { exact: false })).toBeVisible();
    await page.reload();
    await page.getByRole("navigation", { name: "Projetos e sessões" }).getByRole("button", { name: prompt, exact: true }).click();
    await expect(page.getByRole("heading", { name: prompt })).toBeVisible();
    await expect(page.getByText("Vamos trabalhar nessa ideia.", { exact: false })).toBeVisible();
  });

  test("supports quick search, settings and responsive navigation", async ({ page }) => {
    await page.goto("/prototype?demo=1");
    await expect(page.getByRole("heading", { name: "Unificar a experiência remota" })).toBeVisible();
    await page.keyboard.press("Control+k");
    await page.getByRole("textbox", { name: "Buscar comandos e sessões" }).fill("autenticação");
    await page.getByRole("dialog").getByRole("button", { name: "Revisar o fluxo de autenticação" }).click();
    await expect(page.getByRole("heading", { name: "Revisar o fluxo de autenticação" })).toBeVisible();
    await page.getByRole("button", { name: "Configurações", exact: true }).click();
    await page.getByRole("checkbox", { name: /Interface compacta/ }).check();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).not.toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "Abrir navegação", exact: true }).click();
    await page.getByRole("button", { name: "Nova sessão", exact: true }).click();
    await expect(page.getByRole("heading", { name: "O que vamos construir?" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: "test-results/unified-prototype/mobile.png", fullPage: true });
    await page.getByRole("button", { name: "Mostrar contexto da sessão" }).click();
    await expect(page.getByRole("complementary", { name: "Contexto da sessão" })).toBeVisible();
    await page.keyboard.press("Escape");
  });

  test("loads server data read-only and does not disguise connection failures as demonstration data", async ({ page }) => {
    const mutations: string[] = [];
    page.on("request", (request) => { if (/\/api\//.test(request.url()) && request.method() !== "GET") mutations.push(request.method()); });
    await page.route("**/api/repos", (route) => route.fulfill({ status: 503, json: { message: "Fixture unavailable" } }));
    await page.goto("/prototype?demo=1");
    await page.getByRole("button", { name: "Configurações", exact: true }).click();
    await page.getByRole("button", { name: /Consultar servidor/ }).click();
    await expect(page.getByRole("alert")).toContainText("Não foi possível consultar o servidor");
    await expect(page.getByRole("button", { name: "Nova sessão", exact: true })).toBeDisabled();
    expect(mutations).toEqual([]);
    await page.getByRole("button", { name: "Voltar à demonstração" }).click();
    await expect(page.getByRole("button", { name: "Demonstração", exact: true })).toBeVisible();
  });

  test("consults actual API sessions without launching agents", async ({ page, request }) => {
    const repo = await fixtureRepo(request);
    const created = await request.post("/api/tasks", { data: { repoId: repo.id, title: "Sessão real da fixture", description: "Histórico persistido na API de teste.", tags: ["manual"], engine: "opencode" } });
    expect(created.ok()).toBeTruthy();
    const mutations: string[] = [];
    page.on("request", (event) => { if (event.url().includes("/api/") && event.method() !== "GET") mutations.push(event.method()); });
    await page.goto("/prototype?demo=1");
    await page.getByRole("button", { name: "Configurações", exact: true }).click();
    await page.getByRole("button", { name: /Consultar servidor/ }).click();
    await page.getByRole("navigation", { name: "Projetos e sessões" }).getByRole("button", { name: "Sessão real da fixture", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Sessão real da fixture" })).toBeVisible();
    await expect(page.getByText("Histórico persistido na API de teste.", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Servidor conectado", exact: true })).toBeVisible();
    expect(mutations).toEqual([]);
  });

  test("preserves the existing application at the root route", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("tab", { name: "Code", exact: true })).toBeVisible();
    await expect(page.locator(".rw-root")).toHaveCount(0);
  });

  test("configures GitHub inline without persisting credentials in the browser", async ({ page }) => {
    const writes: unknown[] = [];
    await page.route("**/api/settings", async (route) => {
      if (route.request().method() === "PUT") { writes.push(route.request().postDataJSON()); return route.fulfill({ json: { data: { ok: true } } }); }
      return route.continue();
    });
    await page.goto("/prototype?demo=1");
    await page.locator(".rw-sidebar").getByRole("button", { name: "Configurações", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Configurações", exact: true })).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.getByRole("button", { name: "Acesso ao GitHub", exact: true }).click();
    await page.getByLabel("Token de acesso ao GitHub").fill("fixture-credential-not-a-secret");
    await page.getByRole("button", { name: "Salvar acesso ao GitHub" }).click();
    await expect(page.getByRole("status")).toContainText("Configuração salva");
    await expect(page.getByLabel("Token de acesso ao GitHub")).toHaveValue("");
    expect(writes).toEqual([{ githubToken: "fixture-credential-not-a-secret" }]);
    expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain("fixture-credential");
    await page.screenshot({ path: "test-results/unified-prototype/github.png", fullPage: true });
    await page.getByRole("button", { name: "MCP", exact: true }).click();
    await page.getByLabel("Configuração MCP").fill("[]");
    await page.getByRole("button", { name: "Salvar MCP", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("objeto JSON");
    expect(writes).toHaveLength(1);
  });

  test("discovers harness models and effort, persists preferences and handles failures", async ({ page }) => {
    await page.route("**/api/engines/opencode/harness-models", (route) => route.fulfill({ json: { data: [{ id: "fixture/reasoner", name: "Reasoner", efforts: ["fast", "deep"] }, { id: "fixture/plain", name: "Plain", efforts: [] }] } }));
    await page.goto("/prototype?demo=1");
    await page.locator(".rw-sidebar").getByRole("button", { name: "Configurações", exact: true }).click();
    await page.getByRole("button", { name: "Harnesses e modelos", exact: true }).click();
    await page.getByLabel("Modelo padrão do harness").selectOption("fixture/reasoner");
    await page.getByLabel("Effort padrão", { exact: true }).selectOption("deep");
    await page.screenshot({ path: "test-results/unified-prototype/harness-settings.png", fullPage: true });
    await page.reload();
    await page.locator(".rw-sidebar").getByRole("button", { name: "Configurações", exact: true }).click();
    await page.getByRole("button", { name: "Harnesses e modelos", exact: true }).click();
    await expect(page.getByLabel("Effort padrão", { exact: true })).toHaveValue("deep");
    await page.getByLabel("Modelo padrão do harness").selectOption("fixture/plain");
    await expect(page.getByLabel("Effort padrão", { exact: true })).toBeDisabled();
    await expect(page.getByLabel("Effort padrão", { exact: true })).toHaveValue("");
    await page.route("**/api/skills", (route) => route.fulfill({ status: 503, json: { error: "Catálogo indisponível" } }));
    await page.locator(".rw-sidebar").getByRole("button", { name: "Skills", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("Catálogo indisponível");
  });

  test("attaches the current harness terminal and sends selected effort without launching on tab open", async ({ page, request }) => {
    const repo = await fixtureRepo(request);
    expect(repo).toBeTruthy();
    const created = await request.post("/api/tasks", { data: { repoId: repo.id, title: "Terminal harness fixture", engine: "opencode", tags: ["manual"] } });
    const task = (await created.json()).data;
    let live = false;
    const starts: unknown[] = [];
    const frames: { type: string; taskId?: string; input?: string }[] = [];
    await page.route(`**/api/terminal/${task.id}/state`, (route) => route.fulfill({ json: { data: { taskId: task.id, live, engine: "opencode", runId: live ? "fixture-run" : null, cwd: "/fixture/workspace", applied: [], skills: [], skillMode: "auto" } } }));
    await page.route(`**/api/terminal/${task.id}/start`, (route) => { starts.push(route.request().postDataJSON()); live = true; return route.fulfill({ json: { data: { taskId: task.id, live, engine: "opencode", applied: [] } } }); });
    await page.route("**/api/engines/opencode/harness-models", (route) => route.fulfill({ json: { data: [{ id: "fixture/reasoner", name: "Reasoner", efforts: ["deep"] }] } }));
    await page.route("**/api/skills", (route) => route.fulfill({ json: { data: { skills: [{ name: "fixture-ui", description: "Fixture UI skill", filePath: "/fixture/ui/SKILL.md", category: "skill" }], rules: [], agents: [], workflows: [] } } }));
    await page.routeWebSocket("**/ws**", (socket) => { socket.onMessage((raw) => {
      const frame = JSON.parse(String(raw)); frames.push(frame);
      if (frame.type === "terminal_open") socket.send(JSON.stringify({ type: "terminal_output", taskId: task.id, runId: "fixture-run", stream: "stdout", chunk: "OpenCode harness fixture\r\n> ", replay: true }));
    }); });
    await page.goto("/prototype?demo=1");
    await page.locator(".rw-sidebar").getByRole("button", { name: "Configurações", exact: true }).click();
    await page.getByRole("button", { name: /Consultar servidor/ }).click();
    await page.getByRole("navigation", { name: "Projetos e sessões" }).getByRole("button", { name: "Terminal harness fixture", exact: true }).click();
    await page.getByRole("tab", { name: "Terminal", exact: true }).click();
    expect(starts).toHaveLength(0);
    await page.getByLabel("Modelo do terminal").selectOption("fixture/reasoner");
    await page.getByLabel("Effort do terminal").selectOption("deep");
    await page.getByText("Skills desta sessão", { exact: false }).first().click();
    await page.getByRole("checkbox", { name: /fixture-ui/ }).check();
    await page.getByRole("button", { name: "Iniciar OpenCode", exact: true }).click();
    await expect(page.getByRole("region", { name: "Terminal do harness atual" })).toBeVisible();
    expect(starts).toEqual([{ engine: "opencode", model: "fixture/reasoner", effort: "deep", skills: ["fixture-ui"] }]);
    await page.locator(".xterm-helper-textarea").focus();
    await page.keyboard.type("test-input");
    await expect.poll(() => frames.filter((frame) => frame.type === "terminal_input").map((frame) => frame.input).join("")).toBe("test-input");
    expect(frames.filter((frame) => frame.type === "terminal_input").every((frame) => frame.taskId === task.id)).toBe(true);
    await page.screenshot({ path: "test-results/unified-prototype/live-terminal-contract.png", fullPage: true });
    await page.getByRole("tab", { name: "Conversa", exact: true }).click();
    await page.getByRole("tab", { name: "Terminal", exact: true }).click();
    await expect(page.locator(".xterm")).toHaveCount(1);
    expect(starts).toHaveLength(1);
  });

  test("homologates a complete plugin from juninmd/skills through the real GitHub API", async ({ page, request }) => {
    test.skip(process.env.VIBE_PROTOTYPE_LIVE_GITHUB !== "1", "Opt-in live GitHub homologation");
    test.setTimeout(120_000);
    await page.goto("/prototype?demo=1");
    await page.locator(".rw-sidebar").getByRole("button", { name: "Plugins remotos", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.getByRole("button", { name: "Consultar repositório", exact: true }).click();
    await expect(page.getByRole("heading", { name: "juninmd/skills", exact: true })).toBeVisible({ timeout: 45_000 });
    await page.getByLabel("Filtrar plugins remotos").fill(".agents/skills/bot-engineering/SKILL.md");
    await page.screenshot({ path: "test-results/unified-prototype/plugin-catalog.png", fullPage: true });
    await page.locator(".rw-plugin-catalog").getByRole("button", { name: "Importar", exact: true }).click();
    const review = page.getByRole("region", { name: "Revisão do plugin" });
    await expect(review.getByRole("heading", { name: "Revisar bot-engineering" })).toBeVisible({ timeout: 60_000 });
    await expect(review.locator("pre")).toContainText("Bot Engineering");
    await review.getByRole("button", { name: "Ativar plugin", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("Plugin ativado");
    await page.screenshot({ path: "test-results/unified-prototype/plugins-github.png", fullPage: true });
    await page.locator(".rw-sidebar").getByRole("button", { name: "Skills", exact: true }).click();
    await page.getByLabel("Buscar skills", { exact: true }).fill("bot-engineering");
    await page.getByRole("region", { name: "Catálogo de skills" }).getByRole("button", { name: /bot-engineering/ }).click();
    await expect(page.getByRole("region", { name: "Detalhes da skill" })).toContainText("Bot Engineering");
    await page.screenshot({ path: "test-results/unified-prototype/skills.png", fullPage: true });
    const plugins = (await (await request.get("/api/skills/registry")).json()).data;
    const imported = plugins.find((entry: { name: string }) => entry.name === "bot-engineering");
    expect(imported.sourceRepo).toBe("juninmd/skills");
    expect(imported.sourceRef).toMatch(/^[a-f0-9]{40}$/);
    expect(imported.fileCount).toBeGreaterThan(1);
    expect(imported.reviewStatus).toBe("active");
  });

  test("opens the installed OpenCode TUI in the actual workspace without sending a model prompt", async ({ page, request }) => {
    test.skip(process.env.VIBE_PROTOTYPE_LIVE_HARNESS !== "1", "Opt-in installed OpenCode homologation");
    test.setTimeout(120_000);
    const catalogResponse = await request.get("/api/engines/opencode/harness-models");
    expect(catalogResponse.ok()).toBe(true);
    const catalog = (await catalogResponse.json()).data;
    const model = catalog.find((entry: { efforts: string[] }) => entry.efforts.includes("high"));
    expect(model).toBeTruthy();
    const repo = await fixtureRepo(request);
    const created = await request.post("/api/tasks", { data: { repoId: repo.id, title: "OpenCode nativo · homologação", engine: "opencode", model: model.id, tags: ["manual"] } });
    const task = (await created.json()).data;
    const root = process.env.VIBE_E2E_ROOT ?? "";
    const cwd = join(root, "native-harness-workspace");
    execFileSync("git", ["clone", E2E.fixtureRepo, cwd], { stdio: "pipe" });
    mkdirSync(join(cwd, ".vibe-code"), { recursive: true });
    writeFileSync(join(cwd, ".vibe-code/terminal.json"), JSON.stringify({ engine: "opencode" }));
    const seed = join(root, "seed-native-terminal.ts");
    writeFileSync(seed, `import { createDb } from ${JSON.stringify(pathToFileURL(resolve("packages/server/src/db/index.ts")).href)};\nconst db = createDb(${JSON.stringify(join(root,"data/vibe.db"))});\nconst run = db.runs.create(${JSON.stringify(task.id)}, "opencode");\ndb.runs.updateStatus(run.id, "completed", { worktree_path: ${JSON.stringify(cwd)}, finished_at: new Date().toISOString() });\ndb.raw.close();\n`);
    execFileSync("bun", [seed], { stdio: "pipe" });
    try {
      await page.goto("/prototype?demo=1");
      await page.locator(".rw-sidebar").getByRole("button", { name: "Configurações", exact: true }).click();
      await page.getByRole("button", { name: /Consultar servidor/ }).click();
      await page.getByRole("navigation", { name: "Projetos e sessões" }).getByRole("button", { name: "OpenCode nativo · homologação", exact: true }).click();
      await page.getByRole("tab", { name: "Terminal", exact: true }).click();
      await page.getByLabel("Effort do terminal").selectOption("high");
      await page.getByRole("button", { name: "Iniciar OpenCode", exact: true }).click();
      await expect(page.getByRole("region", { name: "Terminal do harness atual" })).toBeVisible();
      await expect.poll(async () => {
        const response = await request.get("/api/terminal");
        return (await response.json()).data.find((terminal: { taskId: string }) => terminal.taskId === task.id)?.preview.join("\n").trim().length ?? 0;
      }, { timeout: 20_000 }).toBeGreaterThan(50);
      await page.screenshot({ path: "test-results/unified-prototype/native-opencode.png", fullPage: true });
      const current = (await (await request.get(`/api/terminal/${task.id}/state`)).json()).data;
      expect(current.engine).toBe("opencode");
      expect(current.model).toBe(model.id);
      expect(current.effort).toBe("high");
      expect(resolve(current.cwd)).toBe(resolve(cwd));
      await page.getByRole("tab", { name: "Conversa", exact: true }).click();
      await page.getByRole("tab", { name: "Terminal", exact: true }).click();
      const resumed = (await (await request.get(`/api/terminal/${task.id}/state`)).json()).data;
      expect(resumed.runId).toBe(current.runId);
    } finally {
      await request.post(`/api/terminal/${task.id}/stop`);
      const marker = join(cwd, ".vibe-code/opencode-session.json");
      try {
        const { id } = JSON.parse(readFileSync(marker,"utf8"));
        const cleanup = join(root,"cleanup-native-terminal.ts");
        writeFileSync(cleanup, `import { harnessCli } from ${JSON.stringify(pathToFileURL(resolve("packages/server/src/terminal/model-catalog.ts")).href)};\nimport { resolveOpencodeBinary } from ${JSON.stringify(pathToFileURL(resolve("packages/server/src/agents/engines/opencode.ts")).href)};\nawait harnessCli([resolveOpencodeBinary(), "api", "delete", ${JSON.stringify(`/api/session/${id}`)}], ${JSON.stringify(cwd)});\n`);
        execFileSync("bun", [cleanup], { stdio: "pipe" });
      } catch { /* The isolated server may have failed before creating a CLI conversation. */ }
    }
  });

  test("adds a project and creates a real manual session without a questionnaire or agent launch", async ({ page, request }) => {
    const source = join(process.env.VIBE_E2E_ROOT ?? "", "project-added-through-ui");
    execFileSync("git", ["clone", E2E.fixtureRepo, source], { stdio: "pipe" });
    await page.goto("/prototype?demo=1");
    await page.locator(".rw-sidebar").getByRole("button", { name: "Configurações", exact: true }).click();
    await page.getByRole("button", { name: "Projetos", exact: true }).click();
    await page.getByLabel("Repositório do projeto").fill(source);
    await page.getByRole("button", { name: "Adicionar projeto", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("Projeto adicionado");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.getByRole("button", { name: "Interface", exact: true }).click();
    await page.getByRole("button", { name: /Consultar servidor/ }).click();
    await page.getByRole("button", { name: "Escolher projeto", exact: true }).click();
    await page.getByRole("button", { name: /servidor\/project-added-through-ui/ }).click();
    const prompt = "Verificar o projeto conectado pelo protótipo";
    await page.getByLabel("Mensagem para o agente").fill(prompt);
    await page.getByRole("button", { name: "Criar sessão", exact: true }).click();
    await expect(page.getByRole("button", { name: "Abrir terminal", exact: true })).toBeVisible();
    const tasks = (await (await request.get("/api/tasks")).json()).data;
    const task = tasks.find((entry: { description: string }) => entry.description === prompt);
    expect(task.tags).toContain("manual");
    expect((await (await request.get(`/api/tasks/${task.id}/runs`)).json()).data).toEqual([]);
  });
});
