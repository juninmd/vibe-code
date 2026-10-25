import { expect, test } from "@playwright/test";
import { E2E } from "../playwright.config";

test("guards both the workspace and prototype alias with the existing login", async ({ page }) => {
  await page.route("**/api/auth/me", (route) => route.fulfill({ json: { data: { enabled: true, authenticated: false } } }));
  for (const path of ["/", "/prototype"]) {
    await page.goto(path);
    await expect(page.getByRole("button", { name: "Sign in with GitHub", exact: true })).toBeVisible();
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
  await expect(page.getByText(title, { exact: true })).toBeVisible();
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
  await expect(page.getByText(title, { exact: true })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.screenshot({ path: "test-results/unified-prototype/real-workspace.png", fullPage: true });
});
