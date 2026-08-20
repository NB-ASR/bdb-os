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

  test("Accounts journeys stay in the consolidated workspaces", async ({ page }) => {
    await signIn(page);

    await page.goto("/accounts");
    await expect(page.getByRole("heading", { name: "Financial control without the clutter" })).toBeVisible();
    await page.locator('a[href="/accounts/sales"]').first().click();
    await expect(page.getByRole("heading", { name: "Sales documents" })).toBeVisible();
    await page.goBack();
    await expect(page.getByRole("heading", { name: "Financial control without the clutter" })).toBeVisible();

    const routes = [
      ["/accounts/sales", "Sales documents"],
      ["/accounts/sales/invoices", "Invoice register"],
      ["/accounts/sales/credit-notes", "Credit Notes"],
      ["/accounts/sales/delivery-notes", "Delivery Notes"],
      ["/accounts/sales/invoices/new", "New Invoice"],
      ["/accounts/sales/credit-notes/new", "New Credit Note"],
      ["/accounts/sales/delivery-notes/new", "New Delivery Note"],
      ["/accounts/payments", "Payments"],
      ["/accounts/payments/new", "Record Payment"],
      ["/accounts/customers", "Customer balances"],
      ["/accounts/settings", "Document setup"],
    ] as const;

    for (const [route, heading] of routes) {
      await page.goto(route);
      await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
      await expect(page).not.toHaveURL(/\/accounts\/operations/);
    }

    await page.goto("/accounts/sales/new");
    await expect(page).toHaveURL(/\/accounts\/sales$/);
    await expect(page.getByRole("heading", { name: "Sales documents", exact: true })).toBeVisible();

    await page.goto("/accounts/settings");
    await page.reload();
    await expect(page.getByRole("heading", { name: "Document setup", exact: true })).toBeVisible();

    await page.goto("/accounts/operations");
    await expect(page).toHaveURL(/\/accounts$/);
    await expect(page.getByRole("heading", { name: "Financial control without the clutter" })).toBeVisible();
  });

  test("Invoice detail exposes permanent document and connected account actions", async ({ page }) => {
    await signIn(page);
    await page.goto("/accounts/sales/invoices");
    await expect(page.getByRole("heading", { name: "Invoice register" })).toBeVisible();
    await page.waitForFunction(() => document.querySelectorAll("tbody tr").length > 0 || document.body.textContent?.includes("No Invoices match these filters"));

    const firstInvoice = page.locator('tbody a[href^="/accounts/sales/invoices/"]').first();
    test.skip(await firstInvoice.count() === 0, "The dedicated E2E workspace has no Invoice fixture.");
    await firstInvoice.click();

    await expect(page.getByText("Original Invoice", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Remaining balance", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: "View" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Print" })).toBeVisible();
    await expect(page.getByRole("link", { name: "PDF" })).toBeVisible();
    await expect(page.getByText("Credit Notes", { exact: true })).toBeVisible();
    await expect(page.getByText("Payments", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Append an internal Note")).toBeVisible();
    await page.reload();
    await expect(page.getByText("Original Invoice", { exact: true }).first()).toBeVisible();
  });
});
