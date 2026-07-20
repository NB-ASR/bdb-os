import { test, expect } from "@playwright/test";

const email = process.env.BDB_E2E_OWNER_EMAIL;
const password = process.env.BDB_E2E_OWNER_PASSWORD;
const workspaceName = process.env.BDB_E2E_WORKSPACE_NAME;

async function signIn(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByLabel("Work email").fill(email ?? "");
  await page.getByLabel("Password").fill(password ?? "");
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(/\/workspace/);
}

test.describe("authenticated owner journey", () => {
  test.skip(!email || !password, "Dedicated E2E owner credentials are not configured.");

  test("owner signs in and sees the assigned workspace", async ({ page }) => {
    await signIn(page);
    await expect(page.getByRole("heading", { name: workspaceName ? new RegExp(workspaceName, "i") : /welcome to/i })).toBeVisible();
  });

  test("owner can create a customer in the dedicated test workspace", async ({ page }) => {
    await signIn(page);
    await page.goto("/customers");

    const uniqueName = `E2E Customer ${Date.now()}`;
    await page.getByRole("button", { name: /add customer/i }).first().click();
    await page.getByLabel("Contact name").fill(uniqueName);
    await page.getByLabel("Company").fill("BDB OS Quality Test");
    await page.getByLabel("Email").fill(`e2e-${Date.now()}@example.invalid`);
    await page.getByRole("button", { name: /^add customer$/i }).click();

    await expect(page.getByText(uniqueName)).toBeVisible();
  });
});
