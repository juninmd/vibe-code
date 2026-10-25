import { expect, test } from "@playwright/test";
import { E2E } from "../playwright.config";

test.use({ video: "on" });

test("captures the production remote workspace and mobile navigation", async ({ page, request }) => {
  const repos = (await (await request.get(`${E2E.serverUrl}/api/repos`)).json()).data;
  let repo = repos.find((item: { url: string }) => item.url === E2E.fixtureRepo);
  if (!repo) {
    repo = (await (await request.post(`${E2E.serverUrl}/api/repos`, { data: { url: E2E.fixtureRepo } })).json()).data;
  }
  await expect
    .poll(async () => (await (await request.get(`${E2E.serverUrl}/api/repos/${repo.id}`)).json()).data.status)
    .toBe("ready");

  const prompt = "Revisar o fluxo de autenticação do projeto de exemplo";
  const task = (await (await request.post(`${E2E.serverUrl}/api/tasks`, {
    data: {
      repoId: repo.id,
      title: prompt,
      description: prompt,
      engine: "opencode",
      baseBranch: "main",
      tags: ["manual", "remote-session"],
    },
  })).json()).data;

  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto(`/?session=${encodeURIComponent(task.id)}`);
  await expect(page.getByRole("heading", { name: prompt, exact: true })).toBeVisible();
  await expect(page.getByText("Carregando a conversa…", { exact: true })).toHaveCount(0);
  await expect(page.locator(".rw-prototype-label")).toHaveCount(0);
  await expect(page.getByRole("complementary", { name: "Contexto da sessão" })).toBeVisible();
  await page.screenshot({ path: "test-results/live-workspace-desktop.png", fullPage: true });

  await page.getByRole("tab", { name: "Alterações" }).click();
  await expect(page.getByRole("heading", { name: /Revisar alterações/ })).toBeVisible();
  await page.screenshot({ path: "test-results/live-workspace-changes.png", fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("tab", { name: "Conversa" }).click();
  await expect(page.getByRole("heading", { name: prompt, exact: true })).toBeVisible();
  await page.screenshot({ path: "test-results/live-workspace-mobile.png", fullPage: true });
  await page.getByRole("button", { name: "Abrir navegação", exact: true }).click();
  await expect(page.getByRole("navigation", { name: "Projetos e sessões" })).toBeVisible();
  await page.screenshot({ path: "test-results/live-workspace-mobile-navigation.png", fullPage: true });
  await page.getByRole("button", { name: "Recolher navegação", exact: true }).click();
  await page.getByRole("button", { name: "Alternar painel de contexto", exact: true }).click();
  await expect(page.getByRole("complementary", { name: "Contexto da sessão" })).toBeVisible();
  expect(pageErrors).toEqual([]);
});
