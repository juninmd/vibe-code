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

test("drives a real shell from the session terminal and survives a reload", async ({ page, request }) => {
  const title = `e2e terminal ${Date.now()}`;
  const created = await request.post(api("/api/tasks"), {
    // "manual" keeps the autopilot away from a task that is driven by hand.
    data: { title, description: title, repoId, tags: ["manual"] },
  });
  expect(created.ok()).toBe(true);
  const taskId = (await created.json()).data.id as string;
  const started = await request.post(api(`/api/terminal/${taskId}/start`), {
    data: { engine: "shell", cols: 100, rows: 30 },
  });
  expect(started.ok()).toBe(true);

  // The Terminais surface lists the live shell; its card opens the session terminal.
  await page.goto("/");
  await page.getByRole("button", { name: "Terminais", exact: true }).click();
  await page.locator(".rw-terminal-card", { hasText: title }).click();

  // Real keyboard input goes to the PTY and the output comes back.
  const screen = page.locator(".xterm-rows");
  await expect(page.getByText("Terminal conectado")).toBeVisible();
  await page.locator(".xterm").click();
  await page.keyboard.type("echo hello-$((40+2))");
  await page.keyboard.press("Enter");
  await expect(screen).toContainText("hello-42");

  // Leaving and coming back must not lose the running session or its screen.
  await page.goto(`/?session=${taskId}`);
  await page.getByRole("tab", { name: /Terminal/ }).click();
  await expect(page.locator(".xterm-rows")).toContainText("hello-42");

  // Stopping ends the process.
  await page.getByRole("button", { name: "Parar harness", exact: true }).click();
  await expect(page.getByText("Terminal inativo")).toBeVisible();
});
