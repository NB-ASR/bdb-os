import { test, expect, type Page } from "@playwright/test";

const email = process.env.BDB_E2E_OWNER_EMAIL;
const password = process.env.BDB_E2E_OWNER_PASSWORD;

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
  await input.setInputFiles({ name: "operational-acceptance.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
}

test.describe("V1 customer operational acceptance", () => {
  test.skip(!email || !password, "Dedicated E2E owner credentials are not configured.");

  test("Customer CSV import is selectable, reviewable and persisted", async ({ page }) => {
    await signIn(page);
    await page.goto("/customers");
    await expect(page.getByRole("button", { name: "Import Customers" })).toBeEnabled();
    await expect(page.getByRole("button", { name: "Legacy Vanita JSON" })).toBeVisible();

    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Template" }).first().click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe("bdb-os-customers-import-template.csv");

    const unique = Date.now();
    const customerName = `Acceptance Customer ${unique}`;
    await uploadCsv(page, `name,email,company\n${customerName},acceptance-${unique}@example.invalid,BDB OS Acceptance\n`);
    await expect(page.getByRole("heading", { name: "Review Customers import" })).toBeVisible();
    await expect(page.getByText(customerName)).toBeVisible();
    await page.getByRole("button", { name: "Confirm 1 Customers" }).click();
    await expect(page.getByText(customerName)).toBeVisible({ timeout: 15_000 });
  });

  test("Product CSV import replaces the old dead catalogue import", async ({ page }) => {
    await signIn(page);
    await page.goto("/products");
    await expect(page.getByRole("button", { name: "Import Products" })).toBeEnabled();
    await expect(page.getByRole("button", { name: /import catalogue/i })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^scan$/i })).toHaveCount(0);

    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Template" }).first().click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe("bdb-os-products-import-template.csv");

    const unique = Date.now();
    const sku = `ACC-${unique}`;
    const productName = `Acceptance Product ${unique}`;
    await uploadCsv(page, `sku,name,purpose,unit_cost,selling_price,vat_rate,reorder_level\n${sku},${productName},resale,10,20,18,2\n`);
    await expect(page.getByRole("heading", { name: "Review Products import" })).toBeVisible();
    await expect(page.getByText(productName)).toBeVisible();
    await page.getByRole("button", { name: "Confirm 1 Products" }).click();
    await expect(page.getByText(productName)).toBeVisible({ timeout: 15_000 });
  });

  test("Service CSV import is available and persisted", async ({ page }) => {
    await signIn(page);
    await page.goto("/services");
    await expect(page.getByRole("button", { name: "Import Services" })).toBeEnabled();

    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Template" }).first().click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe("bdb-os-services-import-template.csv");

    const unique = Date.now();
    const code = `AS-${unique}`;
    const serviceName = `Acceptance Service ${unique}`;
    await uploadCsv(page, `code,name,duration_minutes,price,vat_rate,booking_mode\n${code},${serviceName},45,30,18,customer\n`);
    await expect(page.getByRole("heading", { name: "Review Services import" })).toBeVisible();
    await expect(page.getByText(serviceName)).toBeVisible();
    await page.getByRole("button", { name: "Confirm 1 Services" }).click();
    await expect(page.getByText(serviceName)).toBeVisible({ timeout: 15_000 });
  });
});
