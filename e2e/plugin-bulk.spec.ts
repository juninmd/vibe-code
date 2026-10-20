import { expect, test, type Page } from "@playwright/test";
import type { RegistryAssetRecord } from "@vibe-code/shared";

const commit = "b".repeat(40);
const asset = (name: string, path = `.agents/skills/${name}/SKILL.md`) => ({ name, path, category: "skill", files: 2 });
const record = (name: string): RegistryAssetRecord => ({ id: `skill:${name}`, name, category: "skill", sourceRepo: "team/catalog", sourceRef: commit, sourceUrl: `https://raw.githubusercontent.com/team/catalog/${commit}/.agents/skills/${name}/SKILL.md`, filePath: `/fixture/${name}/SKILL.md`, checksum: "fixture", reviewStatus: "pending_review", installedAt: "2026-10-20T00:00:00Z", reviewedAt: null, fileCount: 2 });

async function openCatalog(page: Page, assets: ReturnType<typeof asset>[], installed: RegistryAssetRecord[]) {
  await page.route("**/api/skills/registry", (route) => route.fulfill({ json: { data: installed } }));
  await page.route("**/api/skills/remote/catalog?**", (route) => route.fulfill({ json: { data: { repo: "team/catalog", ref: "master", commit, assets } } }));
  await page.goto("/prototype?demo=1");
  await page.locator(".rw-sidebar").getByRole("button", { name: "Plugins remotos", exact: true }).click();
  await page.getByLabel("Repositório GitHub do plugin").fill("team/catalog");
  await page.getByRole("button", { name: "Consultar repositório", exact: true }).click();
  await expect(page.getByRole("heading", { name: "team/catalog", exact: true })).toBeVisible();
}

test("bulk imports the complete catalog, preserves existing skills and retries only failures", async ({ page }) => {
  const installed: RegistryAssetRecord[] = [{ ...record("existing"), reviewStatus: "active" }];
  const writes: { repo: string; commit: string; path: string }[] = [];
  const approvals: string[] = [];
  let rejectBroken = true;
  page.on("request", (request) => { if (request.url().includes("/approve")) approvals.push(request.url()); });
  await page.route("**/api/skills/remote/import", (route) => {
    const data = route.request().postDataJSON();
    writes.push(data);
    if (data.path.includes("/broken/") && rejectBroken) return route.fulfill({ status: 400, json: { error: "GitHub respondeu 403." } });
    const imported = record(data.path.split("/").at(-2));
    installed.push(imported);
    return route.fulfill({ json: { data: imported } });
  });
  await openCatalog(page, [asset("existing"), asset("broken"), asset("good", "plugins/web/skills/good/SKILL.md"), asset("good"), { ...asset("agent"), category: "agent" }], installed);
  await page.getByLabel("Filtrar plugins remotos").fill("existing");
  const button = page.getByRole("button", { name: "Importar todas as skills (3)", exact: true });
  await button.click();
  const progress = page.getByRole("region", { name: "Progresso da importação de skills" });
  await expect(progress.getByRole("status")).toContainText("Importação concluída. 3 de 3");
  await expect(progress).toContainText("1 importadas para revisão · 1 já importadas · 1 com falha");
  expect(writes).toEqual(["broken", "good"].map((name) => ({ repo: "team/catalog", commit, path: `.agents/skills/${name}/SKILL.md` })));
  await progress.getByText("Resultado por skill", { exact: true }).click();
  await expect(progress).toContainText("GitHub respondeu 403.");
  await page.screenshot({ path: "test-results/unified-prototype/bulk-import.png", fullPage: true });
  rejectBroken = false;
  await button.click();
  await expect(progress).toContainText("1 importadas para revisão · 2 já importadas · 0 com falha");
  expect(writes).toHaveLength(3);
  expect(writes[2].path).toContain("/broken/");
  expect(approvals).toEqual([]);
  expect(installed.find((item) => item.name === "existing")?.reviewStatus).toBe("active");
});

test("bulk import stops after the in-flight skill without starting another", async ({ page }) => {
  const installed: RegistryAssetRecord[] = [];
  const writes: string[] = [];
  let release = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/skills/remote/import", async (route) => {
    const { path } = route.request().postDataJSON();
    writes.push(path);
    await gate;
    const imported = record("first");
    installed.push(imported);
    await route.fulfill({ json: { data: imported } });
  });
  try {
    await openCatalog(page, [asset("first"), asset("second")], installed);
    await page.getByRole("button", { name: "Importar todas as skills (2)", exact: true }).click();
    const progress = page.getByRole("region", { name: "Progresso da importação de skills" });
    await expect(progress.getByRole("status")).toContainText("Importando first");
    await expect(page.getByRole("button", { name: "Consultar repositório", exact: true })).toBeDisabled();
    await page.getByRole("button", { name: "Parar importação", exact: true }).click();
    await expect(page.getByRole("button", { name: "Parando…", exact: true })).toBeDisabled();
    release();
    await expect(progress.getByRole("status")).toContainText("Importação interrompida. 1 de 2");
    expect(writes).toEqual([".agents/skills/first/SKILL.md"]);
    await expect(page.getByRole("button", { name: "Importar todas as skills (2)", exact: true })).toBeEnabled();
  } finally { release(); }
});
