import { expect, type Page, test } from "@playwright/test";
import { E2E } from "../playwright.config";

/**
 * Browser flow: board loads, the New Task modal exposes its fields, a task is
 * created through the modal and appears on the board, and the task detail
 * modal opens with the created data.
 */

const api = (path: string) => `${E2E.serverUrl}${path}`;

let repoId: string;

test.beforeAll(async ({ request }) => {
  // Ensure the fixture repo is registered and ready (shared with api-smoke)
  const list = await request.get(api("/api/repos"));
  const repos = (await list.json()).data as Array<{ id: string; url: string; status: string }>;
  let repo = repos.find((r) => r.url === E2E.fixtureRepo);
  if (!repo) {
    const created = await request.post(api("/api/repos"), { data: { url: E2E.fixtureRepo } });
    repo = (await created.json()).data;
  }
  if (!repo) throw new Error("Fixture repo could not be registered");
  repoId = repo.id;
  await expect
    .poll(
      async () => {
        const res = await request.get(api("/api/repos"));
        const all = (await res.json()).data as Array<{ id: string; status: string }>;
        return all.find((r) => r.id === repoId)?.status;
      },
      { timeout: 30_000 }
    )
    .toBe("ready");
});

async function openNewTaskModal(page: Page) {
  await page.getByRole("button", { name: "Task", exact: true }).click();
  await expect(page.getByText("Neural Task Construction")).toBeVisible();
}

test.describe("Board UI", () => {
  test("board loads with header actions", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("button", { name: "Task", exact: true })).toBeVisible();
  });

  test("new task modal exposes the expected fields", async ({ page }) => {
    await page.goto("/");
    await openNewTaskModal(page);

    await expect(page.getByText("Target Repository")).toBeVisible();
    await expect(page.getByText("Task Title")).toBeVisible();
    await expect(page.getByText("Implementation Brief")).toBeVisible();
    await expect(page.getByText("Priority", { exact: true })).toBeVisible();
    await expect(page.getByText("AI Engine Matrix")).toBeVisible();
    await expect(page.getByText("Automated Scheduling")).toBeVisible();
    await expect(page.getByText("Ralph Loop")).toBeVisible();

    // Base branch appears once a repository is selected
    const repoInput = page.locator("#new-task-repository");
    await repoInput.click();
    await repoInput.fill("fixture");
    // Scope to the combobox dropdown — the sidebar behind the modal overlay
    // also renders the repo name.
    await page
      .locator("div.relative:has(#new-task-repository) button", { hasText: "fixture-repo" })
      .first()
      .click();
    await expect(page.getByText("Base Branch")).toBeVisible();
  });

  test("creates a task through the modal and opens its detail", async ({ page }) => {
    const title = `e2e ui task ${Date.now()}`;
    await page.goto("/");
    await openNewTaskModal(page);

    // Repository
    const repoInput = page.locator("#new-task-repository");
    await repoInput.click();
    await repoInput.fill("fixture");
    // Scope to the combobox dropdown — the sidebar behind the modal overlay
    // also renders the repo name.
    await page
      .locator("div.relative:has(#new-task-repository) button", { hasText: "fixture-repo" })
      .first()
      .click();

    // Title + description
    await page.locator("#new-task-title").fill(title);
    await page.locator("#new-task-description").fill("Task created by board.spec.ts");

    // Engine: pick the first available engine card
    const engineCard = page.locator("#engine-matrix button").first();
    await engineCard.click();

    // Disable instant execution so no agent is launched
    await page.getByText("Instant Execution").click();

    await page.getByRole("button", { name: "Deploy AI Agent" }).click();

    // Modal closes and the task lands on the board (heading = the board card;
    // the success toast also contains the title, so match by role)
    await expect(page.getByText("Neural Task Construction")).toBeHidden();
    const card = page.getByRole("heading", { name: title });
    await expect(card).toBeVisible();

    // Open the task detail
    await card.click();
    await expect(page.getByText("Task created by board.spec.ts")).toBeVisible();
  });
});
