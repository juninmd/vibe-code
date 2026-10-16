import { expect, test } from "@playwright/test";
import { E2E } from "../playwright.config";

/**
 * Harness Remote code mode: the default surface. The suite-wide storage state
 * seeds kanban mode for the board specs, so this file opts into code mode for
 * its own browser context. Storage state is applied once at context creation,
 * so a reload keeps whatever the app persisted.
 */

test.use({
  storageState: {
    cookies: [],
    origins: [
      {
        origin: E2E.webUrl,
        localStorage: [{ name: "harness-remote-mode", value: "code" }],
      },
    ],
  },
});

let repoId: string;

test.beforeAll(async ({ request }) => {
  // Ensure the fixture repo exists (shared with the other specs).
  const list = await request.get(`${E2E.serverUrl}/api/repos`);
  const repos = (await list.json()).data as Array<{ id: string; url: string; status: string }>;
  let repo = repos.find((r) => r.url === E2E.fixtureRepo);
  if (!repo) {
    const created = await request.post(`${E2E.serverUrl}/api/repos`, {
      data: { url: E2E.fixtureRepo },
    });
    repo = (await created.json()).data;
  }
  if (!repo) throw new Error("Fixture repo could not be registered");
  repoId = repo.id;
  await expect
    .poll(
      async () => {
        const res = await request.get(`${E2E.serverUrl}/api/repos`);
        const all = (await res.json()).data as Array<{ id: string; status: string }>;
        return all.find((r) => r.id === repoId)?.status;
      },
      { timeout: 30_000 }
    )
    .toBe("ready");
});

test.describe("Code mode", () => {
  test("is the default surface and exposes the task composer", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Sessions" })).toBeVisible();
    await expect(page.getByPlaceholder("Describe a task…")).toBeVisible();
    await expect(page.getByRole("tab", { name: "Code" })).toHaveAttribute("aria-selected", "true");
  });

  test("switching to Board shows the kanban view and sticks", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("tab", { name: "Board" }).click();
    await expect(page.getByRole("button", { name: "Task", exact: true })).toBeVisible();
    // The choice is persisted for the next visit.
    await page.reload();
    await expect(page.getByRole("button", { name: "Task", exact: true })).toBeVisible();
  });

  test("opening a session shows the transcript and reply composer", async ({ page }) => {
    const created = await page.request.post(`${E2E.serverUrl}/api/tasks`, {
      data: { repoId, description: "e2e code mode session" },
    });
    expect(created.ok()).toBeTruthy();

    await page.goto("/");
    await page.getByText("e2e code mode session").first().click();

    await expect(page.getByRole("button", { name: "Back to sessions" })).toBeVisible();
    await expect(page.getByPlaceholder(/Reply to the agent|Session is idle/)).toBeVisible();
  });
});
