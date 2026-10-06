import { expect, test } from "@playwright/test";

/**
 * First run: an empty board used to be five empty columns and a form that could not be
 * submitted. The e2e database is shared with the other specs, so the empty state is
 * simulated at the network layer.
 */

test.beforeEach(async ({ page }) => {
  await page.route(/\/api\/repos(\?.*)?$/, (route) =>
    route.request().method() === "GET" ? route.fulfill({ json: { data: [] } }) : route.continue()
  );
  await page.route(/\/api\/tasks(\?.*)?$/, (route) =>
    route.request().method() === "GET" ? route.fulfill({ json: { data: [] } }) : route.continue()
  );
});

test("an empty install explains what to do first", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Welcome to vibe-code" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Installed agents" })).toBeVisible();

  // The board itself stays out of the way until there is something to put on it.
  await expect(page.getByText("No tasks in Todo")).toBeHidden();

  await page.getByRole("button", { name: "Add repository" }).first().click();
  await expect(page.getByText("Add Repository", { exact: true })).toBeVisible();
});

test("New task without a repository leads to adding one", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Welcome to vibe-code" })).toBeVisible();

  await page.getByRole("button", { name: "Task", exact: true }).click();

  await expect(page.getByText("Add a repository first")).toBeVisible();
  await expect(page.getByText("Add Repository", { exact: true })).toBeVisible();
  await expect(page.getByText("No repositories found")).toBeHidden();
});

test("the header menu opens the shortcuts reference", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Menu" }).click();
  await page.getByRole("menuitem", { name: "Keyboard shortcuts" }).click();
  await expect(page.getByText(/Board shortcuts are off while a task terminal has focus/)).toBeVisible();
  await expect(page.getByText("Neural Interface Bindings")).toBeHidden();
});
