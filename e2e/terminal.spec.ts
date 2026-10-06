import { expect, test } from "@playwright/test";
import { E2E } from "../playwright.config";

/**
 * The task terminal, end to end: a real PTY on the server, xterm in the browser.
 * Uses the plain "Shell" harness so it needs no agent CLI installed.
 */

test.skip(process.platform === "win32", "PTY terminals need a POSIX host");

const api = (path: string) => `${E2E.serverUrl}${path}`;

let repoId: string;

test.beforeAll(async ({ request }) => {
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

test("drives a real shell from the task panel and survives a reload", async ({ page, request }) => {
  const title = `e2e terminal ${Date.now()}`;
  const created = await request.post(api("/api/tasks"), {
    // "manual" keeps the autopilot away from a task that is driven by hand.
    data: { title, description: "Try the terminal", repoId, tags: ["manual"] },
  });
  expect(created.ok()).toBe(true);

  await page.goto("/");
  await page.getByRole("heading", { name: title }).click();

  // Idle card: pick the plain shell and start it.
  await page.getByRole("button", { name: "Shell", exact: true }).click();
  await page.getByRole("button", { name: /^Start Shell/ }).click();

  // Real keyboard input goes to the PTY and the output comes back.
  const screen = page.locator(".xterm-rows");
  await expect(page.getByRole("button", { name: "Finish" })).toBeVisible();
  await page.locator(".xterm").click();
  await page.keyboard.type("echo hello-$((40+2))");
  await page.keyboard.press("Enter");
  await expect(screen).toContainText("hello-42");

  // Leaving and coming back must not lose the running session or its screen.
  await page.reload();
  await page.getByRole("heading", { name: title }).click();
  await expect(page.getByRole("button", { name: "Finish" })).toBeVisible();
  await expect(page.locator(".xterm-rows")).toContainText("hello-42");

  // Stopping ends the process and hands the task back.
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(page.locator(".xterm-rows")).toContainText("session stopped");
  await expect(page.getByRole("button", { name: "Finish" })).toBeHidden();
});
