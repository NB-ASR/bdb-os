import { test, expect, type Page } from "@playwright/test";

const email = process.env.BDB_E2E_OWNER_EMAIL;
const password = process.env.BDB_E2E_OWNER_PASSWORD;
const workspaceName = process.env.BDB_E2E_WORKSPACE_NAME;

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Work email").fill(email ?? "");
  await page.getByLabel("Password").fill(password ?? "");
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(/\/workspace/);
}

async function uploadCsv(page: Page, csv: string) {
  const input = page.locator('input[type="file"][accept*=".csv"]').first();
  await expect(input).toBeAttached();
  await input.setInputFiles({
    name: "operational-acceptance.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(csv),
  });
}

async function expectTemplateDownload(page: Page, expectedName: string) {
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Template" }).first().click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe(expectedName);
}

async function waitForRecordRow(page: Page, text: string) {
  const row = page.locator("tbody tr").filter({ hasText: text }).first();
  await expect(row).toBeVisible({ timeout: 15_000 });
  return row;
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
    await page.getByLabel("Customer name").fill(uniqueName);
    await page.getByLabel("Company").fill("BDB OS Quality Test");
    await page.getByLabel("Email").fill(`e2e-${Date.now()}@example.invalid`);
    await page.getByRole("button", { name: /^create customer$/i }).click();

    await expect(page).toHaveURL(/\/customers\//);
    await expect(page.getByText(uniqueName).first()).toBeVisible();
  });

  test("Customer CSV import and lifecycle are customer-operational", async ({ page }) => {
    await signIn(page);
    await page.goto("/customers");
    await expect(page.getByRole("button", { name: "Import Customers" })).toBeEnabled();
    await expect(page.getByRole("button", { name: "Legacy Vanita JSON" })).toBeVisible();
    await expectTemplateDownload(page, "bdb-os-customers-import-template.csv");

    const unique = Date.now();
    const customerName = `Acceptance Customer ${unique}`;
    const updatedCompany = `Acceptance Company ${unique}`;
    await uploadCsv(page, `name,email,company\n${customerName},acceptance-${unique}@example.invalid,BDB OS Acceptance\n`);
    await expect(page.getByRole("heading", { name: "Review Customers import" })).toBeVisible();
    await expect(page.getByText(customerName)).toBeVisible();
    await page.getByRole("button", { name: "Confirm 1 Customers" }).click();

    await page.getByLabel("Search Customers").fill(customerName);
    let row = await waitForRecordRow(page, customerName);
    await row.getByRole("button", { name: "Edit" }).click();
    await page.getByLabel("Company").fill(updatedCompany);
    await page.getByRole("button", { name: "Save changes" }).click();
    row = await waitForRecordRow(page, customerName);
    await expect(row).toContainText(updatedCompany);

    await row.getByRole("button", { name: "Archive" }).click();
    await page.getByRole("button", { name: "Archived", exact: true }).click();
    row = await waitForRecordRow(page, customerName);
    await expect(row).toContainText("Archived");
    await row.getByRole("button", { name: "Restore" }).click();
    await page.getByRole("button", { name: "Active", exact: true }).click();
    row = await waitForRecordRow(page, customerName);
    await expect(row).toContainText("Active");
  });

  test("Product CSV import and lifecycle replace the old dead catalogue controls", async ({ page }) => {
    await signIn(page);
    await page.goto("/products");
    await expect(page.getByRole("button", { name: "Import Products" })).toBeEnabled();
    await expect(page.getByRole("button", { name: /import catalogue/i })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^scan$/i })).toHaveCount(0);
    await expectTemplateDownload(page, "bdb-os-products-import-template.csv");

    const unique = Date.now();
    const sku = `ACC-${unique}`;
    const productName = `Acceptance Product ${unique}`;
    const updatedName = `${productName} Updated`;
    await uploadCsv(page, `sku,name,purpose,unit_cost,selling_price,vat_rate,reorder_level\n${sku},${productName},resale,10,20,18,2\n`);
    await expect(page.getByRole("heading", { name: "Review Products import" })).toBeVisible();
    await expect(page.getByText(productName)).toBeVisible();
    await page.getByRole("button", { name: "Confirm 1 Products" }).click();

    await page.getByLabel("Search products").fill(sku);
    let row = await waitForRecordRow(page, sku);
    await row.getByRole("button", { name: "Edit" }).click();
    await page.getByLabel("Product name").fill(updatedName);
    await page.getByRole("button", { name: "Save changes" }).click();
    row = await waitForRecordRow(page, sku);
    await expect(row).toContainText(updatedName);

    await row.getByRole("button", { name: "Archive" }).click();
    await page.getByRole("button", { name: "Archived", exact: true }).click();
    row = await waitForRecordRow(page, sku);
    await expect(row).toContainText("Archived");
    await row.getByRole("button", { name: "Restore" }).click();
    await page.getByRole("button", { name: "All active", exact: true }).click();
    row = await waitForRecordRow(page, sku);
    await expect(row).toContainText("Active");
  });

  test("Service CSV import and lifecycle are customer-operational", async ({ page }) => {
    await signIn(page);
    await page.goto("/services");
    await expect(page.getByRole("button", { name: "Import Services" })).toBeEnabled();
    await expectTemplateDownload(page, "bdb-os-services-import-template.csv");

    const unique = Date.now();
    const code = `AS-${unique}`;
    const serviceName = `Acceptance Service ${unique}`;
    const updatedName = `${serviceName} Updated`;
    await uploadCsv(page, `code,name,duration_minutes,price,vat_rate,booking_mode\n${code},${serviceName},45,30,18,customer\n`);
    await expect(page.getByRole("heading", { name: "Review Services import" })).toBeVisible();
    await expect(page.getByText(serviceName)).toBeVisible();
    await page.getByRole("button", { name: "Confirm 1 Services" }).click();

    await page.getByLabel("Search Services").fill(code);
    let row = await waitForRecordRow(page, code);
    await row.getByRole("button", { name: "Edit" }).click();
    await page.getByLabel("Service name").fill(updatedName);
    await page.getByRole("button", { name: "Save changes" }).click();
    row = await waitForRecordRow(page, code);
    await expect(row).toContainText(updatedName);

    await row.getByRole("button", { name: "Archive" }).click();
    await page.getByRole("button", { name: "Archived", exact: true }).click();
    row = await waitForRecordRow(page, code);
    await expect(row).toContainText("Archived");
    await row.getByRole("button", { name: "Restore" }).click();
    await page.getByRole("button", { name: "All", exact: true }).click();
    row = await waitForRecordRow(page, code);
    await expect(row).toContainText("Active");
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
