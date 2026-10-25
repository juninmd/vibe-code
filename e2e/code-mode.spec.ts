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
    await page.goto("/legacy");
    await expect(page.getByRole("heading", { name: "What will you build?" })).toBeVisible();
    await expect(page.getByPlaceholder("Describe a task…")).toBeVisible();
    await expect(page.getByRole("tab", { name: "Code" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("navigation", { name: "Sessions", exact: true })).toBeVisible();
    await expect(page.getByLabel("Agent engine")).toBeVisible();
    await page.screenshot({ path: "test-results/remote-code-desktop.png", fullPage: true });
  });

  test("switching to Board shows the kanban view and sticks", async ({ page }) => {
    await page.goto("/legacy");
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

    await page.goto("/legacy");
    await page.getByRole("navigation", { name: "Sessions", exact: true }).getByText(/e2e-code-mode-session/).first().click();

    await expect(page.getByRole("button", { name: "Back to sessions" })).toBeVisible();
    await expect(page.getByPlaceholder(/Reply to the agent|Session is idle/)).toBeVisible();
  });

  test("creates a session with the chosen engine, model and branch", async ({ page }) => {
    await page.route("**/api/engines", (route) => route.fulfill({ json: { data: [{ name: "opencode", displayName: "OpenCode", available: true, version: "test", activeRuns: 0, supportsResume: true }] } }));
    await page.route("**/api/engines/opencode/models", (route) => route.fulfill({ json: { data: ["fixture/model"] } }));
    // Only execution is intercepted; repository registration and task persistence use the real API.
    await page.route("**/api/tasks/*/launch", (route) => route.fulfill({ status: 202, json: { data: { id: "fixture-run", engine: "opencode", status: "queued" } } }));
    await page.goto("/legacy");
    await page.getByLabel("Agent model").selectOption("fixture/model");
    await page.getByPlaceholder("Describe a task…").fill("e2e remote conversation");
    const created = page.waitForResponse((response) => response.url().endsWith("/api/tasks") && response.request().method() === "POST");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    const response = await created;
    expect(response.ok()).toBeTruthy();
    const task = (await response.json()).data;
    expect(task.engine).toBe("opencode");
    expect(task.model).toBe("fixture/model");
    expect(task.baseBranch).toBe("main");
    expect(task.tags).toContain("remote-session");
    await expect(page.getByPlaceholder("Continue this session…")).toBeVisible();
    await expect(page.getByText("e2e remote conversation", { exact: true })).toBeVisible();
    await page.screenshot({ path: "test-results/remote-code-conversation.png", fullPage: true });
  });

  test("keeps history and repository controls usable on a phone", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.route("**/api/engines", (route) => route.fulfill({ json: { data: [{ name: "opencode", displayName: "OpenCode", available: true, version: "test", activeRuns: 0, supportsResume: true }] } }));
    await page.route("**/api/engines/opencode/models", (route) => route.fulfill({ json: { data: ["opencode/beam-free"] } }));
    await page.goto("/legacy");
    await expect(page.getByPlaceholder("Describe a task…")).toBeVisible();
    await page.getByRole("button", { name: "Session history", exact: true }).click();
    await expect(page.getByRole("navigation", { name: "Sessions", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "New session", exact: true }).click();
    await page.getByLabel("Choose repository").click();
    await expect(page.getByLabel("Search repositories")).toBeVisible();
    // Close the picker so the capture shows the composer, not the fixture path.
    await page.keyboard.press("Escape");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: "test-results/remote-code-mobile.png", fullPage: true });
  });

  test("continues a real OpenCode conversation and restores its history after reload", async ({ page, request }) => {
    test.skip(process.env.VIBE_E2E_REAL_OPENCODE !== "1", "Opt in to a real model call with VIBE_E2E_REAL_OPENCODE=1");
    test.setTimeout(120_000);
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    const listed = await request.get(`${E2E.serverUrl}/api/engines/opencode/models`);
    expect(listed.ok()).toBeTruthy();
    const models = (await listed.json()).data as string[];
    const model = models.find((m) => m.startsWith("opencode/") && m.endsWith("-free"));
    if (!model) throw new Error("No free model was reported by the installed OpenCode CLI");
    await page.goto("/legacy");
    await page.getByLabel("Agent model").selectOption(model, { timeout: 30_000 });
    await page.getByPlaceholder("Describe a task…").fill("Remember the marker REMOTE_BROWSER_742. Reply only REMOTE_READY.");
    const created = page.waitForResponse((response) => response.url().endsWith("/api/tasks") && response.request().method() === "POST");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    const task = (await (await created).json()).data;
    await expect(page.locator(".chat-markdown").getByText("REMOTE_READY", { exact: true })).toBeVisible({ timeout: 60_000 });
    const reply = page.getByPlaceholder("Continue this session…");
    await expect(reply).toBeEnabled({ timeout: 30_000 });
    await reply.fill("What marker did I ask you to remember? Reply only with that marker.");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(page.locator(".chat-markdown").getByText("REMOTE_BROWSER_742", { exact: true })).toBeVisible({ timeout: 60_000 });
    const runsResponse = await request.get(`${E2E.serverUrl}/api/tasks/${task.id}/runs`);
    const runs = (await runsResponse.json()).data as Array<{ sessionId: string; worktreePath: string }>;
    expect(runs).toHaveLength(2);
    expect(runs[0].sessionId).toBeTruthy();
    expect(runs[0].sessionId).toBe(runs[1].sessionId);
    expect(runs[0].worktreePath).toBe(runs[1].worktreePath);
    await page.reload();
    await page.getByRole("navigation", { name: "Sessions", exact: true }).getByText(task.title, { exact: true }).click();
    await expect(page.locator(".chat-markdown").getByText("REMOTE_READY", { exact: true })).toBeVisible();
    await expect(page.locator(".chat-markdown").getByText("REMOTE_BROWSER_742", { exact: true })).toBeVisible();
    expect(pageErrors).toEqual([]);
    await page.screenshot({ path: "test-results/remote-code-real-opencode.png", fullPage: true });
  });
});
