import { expect, test } from "@playwright/test";
import { E2E } from "../playwright.config";

test("guards both the workspace and prototype alias with the existing login", async ({ page }) => {
  await page.route("**/api/auth/me", (route) => route.fulfill({ json: { data: { enabled: true, authenticated: false } } }));
  for (const path of ["/", "/prototype"]) {
    await page.goto(path);
    await expect(page.getByRole("button", { name: "Entrar com GitHub", exact: true })).toBeVisible();
    await expect(page.locator(".rw-root")).toHaveCount(0);
  }
});

test("creates a real conversational task with model effort and keeps failed follow-up drafts", async ({ page, request }) => {
  let repo = (await (await request.get(`${E2E.serverUrl}/api/repos`)).json()).data.find((item: { url: string }) => item.url === E2E.fixtureRepo);
  if (!repo) repo = (await (await request.post(`${E2E.serverUrl}/api/repos`, { data: { url: E2E.fixtureRepo } })).json()).data;
  await expect.poll(async () => (await (await request.get(`${E2E.serverUrl}/api/repos/${repo.id}`)).json()).data.status).toBe("ready");
  await page.route("**/api/engines", (route) => route.fulfill({ json: { data: [
    { name: "opencode", displayName: "OpenCode", available: true, supportsResume: true },
    { name: "grok", displayName: "Grok CLI", available: true, supportsResume: true },
    { name: "claude-code", displayName: "Claude Code", available: true, supportsResume: false },
    { name: "shell-agent", displayName: "Shell Agent", available: true, supportsResume: false },
    { name: "acpx", displayName: "ACP Adapter", available: false, supportsResume: true },
  ] } }));
  await page.route("**/api/engines/opencode/harness-models", (route) => route.fulfill({ json: { data: [{ id: "fixture/reasoner", name: "Reasoner", efforts: ["deep"] }] } }));
  const launches: string[] = [];
  await page.route("**/api/tasks/*/launch", (route) => { launches.push(route.request().url()); return route.fulfill({ json: { data: { id: "fixture-run", status: "running" } } }); });
  let reject = true;
  const messages: { task: string; message: string }[] = [];
  await page.route("**/api/tasks/*/messages", (route) => {
    messages.push({ task: route.request().url().split("/").at(-2) ?? "", message: route.request().postDataJSON().message });
    return route.fulfill({ status: reject ? 503 : 202, json: reject ? { message: "Fixture indisponível" } : { data: { id: "fixture-followup" } } });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Nova sessão", exact: true }).click();
  const engineSelect = page.getByLabel("Engine da sessão", { exact: true });
  await expect(engineSelect.locator("option")).toHaveText([
    "OpenCode",
    "Grok CLI",
    "Claude Code",
  ]);
  await expect(engineSelect.locator('option[value="shell-agent"]')).toHaveCount(0);
  await expect(engineSelect.locator('option[value="acpx"]')).toHaveCount(0);
  await engineSelect.selectOption("grok");
  await expect(engineSelect).toHaveValue("grok");
  await engineSelect.selectOption("opencode");
  await page.getByLabel("Modelo da sessão", { exact: true }).selectOption("fixture/reasoner");
  await page.getByLabel("Effort do modelo", { exact: true }).selectOption("deep");
  const title = "Revisar o workspace de integração";
  await page.getByLabel("Mensagem para o agente").fill(title);
  await page.getByRole("button", { name: "Criar sessão", exact: true }).click();
  await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
  await expect.poll(() => launches.length).toBe(1);
  const task = (await (await request.get(`${E2E.serverUrl}/api/tasks`)).json()).data.find((item: { description: string }) => item.description === title);
  expect(task.engine).toBe("opencode");
  expect(task.model).toBe("fixture/reasoner#deep");
  expect(task.tags).toEqual(expect.arrayContaining(["manual", "remote-session"]));
  await page.getByLabel("Mensagem para o agente").fill("Continue preservando o contexto");
  await page.getByRole("button", { name: "Enviar mensagem", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Fixture indisponível");
  await expect(page.getByLabel("Mensagem para o agente")).toHaveValue("Continue preservando o contexto");
  reject = false;
  await page.getByRole("button", { name: "Enviar mensagem", exact: true }).click();
  await expect(page.getByLabel("Mensagem para o agente")).toHaveValue("");
  expect(messages.map((item) => item.task)).toEqual([task.id, task.id]);
  await page.reload();
  await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.screenshot({ path: "test-results/unified-prototype/real-workspace.png", fullPage: true });
});

test("a running remote conversation appears in Terminais and the 3D office", async ({ page, request }) => {
  let repo = (await (await request.get(`${E2E.serverUrl}/api/repos`)).json()).data.find((item: { url: string }) => item.url === E2E.fixtureRepo);
  if (!repo) repo = (await (await request.post(`${E2E.serverUrl}/api/repos`, { data: { url: E2E.fixtureRepo } })).json()).data;
  await expect.poll(async () => (await (await request.get(`${E2E.serverUrl}/api/repos/${repo.id}`)).json()).data.status).toBe("ready");
  const title = `Conversa remota ativa ${Date.now()}`;
  const created = await request.post(`${E2E.serverUrl}/api/tasks`, {
    data: { title, description: title, repoId: repo.id, engine: "opencode", tags: ["manual", "remote-session"] },
  });
  const createdBody = await created.json();
  expect(created.ok(), JSON.stringify(createdBody)).toBe(true);
  const taskId = createdBody.data.id as string;
  await request.patch(`${E2E.serverUrl}/api/tasks/${taskId}`, { data: { status: "in_progress" } });

  await page.goto("/");
  await page.getByRole("button", { name: "Terminais", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Conversas em andamento" })).toBeVisible();
  await expect(page.locator(".rw-session-table").getByRole("button", { name: new RegExp(title) })).toBeVisible();

  await page.getByRole("button", { name: "Escritório 3D", exact: true }).click();
  await expect(page.locator(".rw-office-chip", { hasText: /[1-9]\d* (sessão aberta|sessões abertas)/ })).toBeVisible();
});

test("settings group the connection steps and show what is still missing", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Configurações", exact: true }).click();
  const setup = page.getByRole("region", { name: "Primeiros passos" });
  await expect(setup.getByText("Conectar o GitHub")).toBeVisible();
  await expect(setup.getByText("Adicionar uma chave de LLM")).toBeVisible();
  await page.screenshot({ path: "test-results/settings-setup.png", fullPage: true });
  await setup.getByRole("button", { name: "Adicionar chave" }).click();
  await expect(page.getByRole("heading", { name: "Chaves de LLM" })).toBeVisible();
});

for (const [device, viewport] of [["desktop", { width: 1440, height: 900 }], ["mobile", { width: 390, height: 844 }]] as const) {
  test(`adds a project from the sidebar without opening settings (${device})`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.route("**/api/repos/github/list", (route) =>
      route.fulfill({ json: { data: [{ name: "site", url: "https://github.com/acme/site.git", description: "Site institucional", isPrivate: true, provider: "github" }] } })
    );
    await page.goto("/");
    if (device === "mobile") await page.getByRole("button", { name: /menu|navegação/i }).first().click();
    await page.getByRole("button", { name: "Adicionar projeto", exact: true }).first().click();
    const dialog = page.getByRole("dialog", { name: "Adicionar projeto" });
    await expect(dialog.getByRole("button", { name: "Ativar site" })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Adicionar por URL" })).toBeDisabled();
    await page.screenshot({ path: `test-results/add-project-${device}.png` });
  });
}
