import { test, expect, type Page } from "@playwright/test";
import { CUSTOMER_XLSX_BASE64, CUSTOMER_XLSX_CASES } from "../fixtures/customer-import-xlsx";

const email = process.env.BDB_E2E_OWNER_EMAIL;
const password = process.env.BDB_E2E_OWNER_PASSWORD;
const workspaceName = process.env.BDB_E2E_WORKSPACE_NAME;

type PersistedRow = { id: string; name: string; status: string; barcode?: string };

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

async function uploadCustomerXlsx(page: Page) {
  const input = page.locator('input[type="file"][accept*=".xlsx"]').first();
  await expect(input).toBeAttached();
  await input.setInputFiles({
    name: "sanitized-customer-export.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: Buffer.from(CUSTOMER_XLSX_BASE64, "base64"),
  });
}

async function expectTemplateDownload(page: Page, expectedName: string) {
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Template" }).first().click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe(expectedName);
}

async function confirmImportAndWaitForRegister(page: Page, buttonName: string) {
  await page.getByRole("button", { name: buttonName }).click();
  await expect(page.getByRole("heading", { name: /^Review .* import$/ })).toHaveCount(0, { timeout: 60_000 });
  await expect(page.getByRole("status")).toContainText(/Imported \d+ · Needs review \d+ · Failed \d+/i);
}

async function confirmCustomerImportAndWaitForRegister(page: Page, buttonName: string) {
  const importButton = page.getByRole("button", { name: "Import Customers" });
  await page.getByRole("button", { name: buttonName }).click();
  await expect(importButton).toBeEnabled({ timeout: 60_000 });
  await expect(page.getByRole("status")).toContainText(/Imported \d+ · Needs review \d+ · Failed \d+/i);
}

async function waitForRecordRow(page: Page, text: string) {
  const row = page.locator("tbody tr").filter({ hasText: text }).first();
  await expect(row).toBeVisible({ timeout: 15_000 });
  return row;
}

const registers = [
  { entity: "customers", label: "Customers", singular: "Customer", search: "Search Customers", active: "Active", next: "Next", keyHeading: "email" },
  { entity: "products", label: "Products", singular: "Product", search: "Search products", active: "All active", next: "Load more", keyHeading: "sku" },
  { entity: "services", label: "Services", singular: "Service", search: "Search Services", active: "All", next: "Load more", keyHeading: "code" },
] as const;

async function currentWorkspace(page: Page) {
  const response = await page.request.get("/api/workspace/context");
  expect(response.ok()).toBeTruthy();
  const context = await response.json();
  expect(context.currentWorkspaceId).toBeTruthy();
  return String(context.currentWorkspaceId);
}

async function persistedRows(page: Page, entity: string, workspaceId: string, search: string, archived = false) {
  const params = new URLSearchParams({ workspaceId });
  if (entity === "customers") {
    params.set("limit", "50"); params.set("search", search); params.set("filter", archived ? "archived" : "active");
  } else {
    params.set("pageSize", "100"); params.set("query", search); params.set("status", archived ? "archived" : "active");
  }
  const response = await page.request.get(`/api/${entity}?${params}`);
  expect(response.ok()).toBeTruthy();
  const result = await response.json();
  expect(result.ok).toBe(true);
  if (entity === "customers") {
    const items = (result.result?.items ?? []) as Array<{ rowKind?: string; customer?: PersistedRow }>;
    return items.flatMap((item) => item.rowKind === "customer" && item.customer ? [item.customer] : []);
  }
  return result.result[entity] as PersistedRow[];
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

  test("only a reauthenticated owner can permanently delete an unreferenced archived Customer", async ({ page }) => {
    await signIn(page);
    const workspaceId = await currentWorkspace(page);
    const id = crypto.randomUUID();
    const name = `Delete Guard ${Date.now()}`;
    const createResponse = await page.request.post("/api/customers", { headers: { "Idempotency-Key": crypto.randomUUID() }, data: { workspaceId, action: "create", id, name, email: `delete-${Date.now()}@example.invalid` } });
    expect(createResponse.ok()).toBeTruthy();
    const archiveResponse = await page.request.post("/api/customers", { headers: { "Idempotency-Key": crypto.randomUUID() }, data: { workspaceId, action: "archive", id, expectedVersion: 1 } });
    expect(archiveResponse.ok()).toBeTruthy();
    await page.goto("/customers");
    await page.getByRole("button", { name: "Archived", exact: true }).click();
    await page.getByLabel("Search Customers").fill(name);
    const row = await waitForRecordRow(page, name);
    await row.getByRole("button", { name: "Delete", exact: true }).click();
    await page.getByLabel("Signed-in owner email").fill(email!);
    await page.getByLabel("Current password").fill(password!);
    await page.getByRole("button", { name: "Permanently delete", exact: true }).click();
    await expect(page.getByText("Customer permanently deleted.")).toBeVisible();
    await expect(row).toHaveCount(0);
  });

  test("Customer register reloads from its cached shell and cached page while offline", async ({ page, context }) => {
    test.setTimeout(90_000);
    await signIn(page);
    await page.goto("/customers");
    await expect(page.getByRole("heading", { name: "Customers", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Import Customers" })).toBeEnabled();
    await page.evaluate(async () => {
      if (!("serviceWorker" in navigator)) throw new Error("Service workers are unavailable in this browser.");
      await navigator.serviceWorker.ready;
    });
    await page.reload();
    await expect(page.getByRole("heading", { name: "Customers", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Import Customers" })).toBeEnabled();

    try {
      await context.setOffline(true);
      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(page.getByRole("heading", { name: "Customers", exact: true })).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText(/Showing the last cached Active Customer page|Showing the bounded offline Customer working set/)).toBeVisible();
      await expect(page.getByRole("button", { name: "Import Customers" })).toBeDisabled();
    } finally {
      await context.setOffline(false);
    }
  });

  test("Customer CSV import refresh and lifecycle are customer-operational", async ({ page }) => {
    await signIn(page);
    await page.goto("/customers");
    await expect(page.getByRole("button", { name: "Import Customers" })).toBeEnabled();
    await expect(page.getByRole("button", { name: "Legacy Vanita JSON" })).toHaveCount(0);
    await expectTemplateDownload(page, "bdb-os-customers-import-template.csv");

    const unique = Date.now();
    const customerName = `000 Acceptance Customer ${unique}`;
    const updatedCompany = `Acceptance Company ${unique}`;
    await uploadCsv(page, `name,email,company\n${customerName},acceptance-${unique}@example.invalid,BDB OS Acceptance\n`);
    await expect(page.getByRole("heading", { name: "Review Customers import" })).toBeVisible();
    await expect(page.getByText(customerName)).toBeVisible();
    await confirmCustomerImportAndWaitForRegister(page, "Confirm 1 Customers");

    // The imported row must already be in the current register before search changes.
    let row = await waitForRecordRow(page, customerName);
    await page.getByLabel("Search Customers").fill(customerName);
    row = await waitForRecordRow(page, customerName);
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

  test("Customer XLSX import handles common business export layouts", async ({ page }) => {
    await signIn(page);
    await page.goto("/customers");
    await uploadCustomerXlsx(page);

    await expect(page.getByRole("heading", { name: "Review Customers import" })).toBeVisible();
    await expect(page.getByText("Ava Borg").first()).toBeVisible();
    await expect(page.getByText("Liam Camilleri").first()).toBeVisible();
    await confirmCustomerImportAndWaitForRegister(page, "Confirm 2 Customers");

    await page.getByLabel("Search Customers").fill("Ava Borg");
    const row = await waitForRecordRow(page, "Ava Borg");
    await expect(row).toContainText("ava.borg@example.invalid");
    await expect(row).toContainText("+356 70000001");
    await expect(row).toContainText("1 Test Street, Valletta");
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
    await confirmImportAndWaitForRegister(page, "Confirm 1 Products");

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
    await confirmImportAndWaitForRegister(page, "Confirm 1 Services");

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

  test("Customer import revalidates the active workspace before commit", async ({ page }) => {
    await signIn(page);
    await page.goto("/customers");
    await expect(page.getByRole("button", { name: "Import Customers" })).toBeEnabled();

    let postAttempts = 0;
    await page.route("**/api/customers", async (route) => {
      if (route.request().method() === "POST") postAttempts += 1;
      await route.continue();
    });
    await uploadCsv(page, "name,email\nWorkspace Guard,workspace-guard@example.invalid\n");
    await expect(page.getByRole("heading", { name: "Review Customers import" })).toBeVisible();

    await page.route("**/api/workspace/context", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ currentWorkspaceId: "76000000-0000-4000-8000-000000000099" }),
      });
    });
    await page.getByRole("button", { name: "Confirm 1 Customers" }).click();

    await expect(page.getByRole("heading", { name: "Review Customers import" })).toHaveCount(0);
    await expect(page.getByRole("alert")).toContainText("active workspace changed");
    expect(postAttempts).toBe(0);
  });

  test("Customer import stops after a workspace-level rejection", async ({ page }) => {
    await signIn(page);
    await page.goto("/customers");
    await expect(page.getByRole("button", { name: "Import Customers" })).toBeEnabled();

    let postAttempts = 0;
    await page.route("**/api/customers", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      postAttempts += 1;
      await route.fulfill({
        status: 403,
        contentType: "application/json",
        body: JSON.stringify({ ok: false, code: "WORKSPACE_FORBIDDEN", error: "This workspace is not available." }),
      });
    });
    const rows = Array.from({ length: 40 }, (_, index) => {
      const suffix = String(index + 1).padStart(2, "0");
      return `Workspace Guard ${suffix},workspace-guard-${suffix}@example.invalid`;
    });
    await uploadCsv(page, `name,email\n${rows.join("\n")}\n`);
    await expect(page.getByRole("heading", { name: "Review Customers import" })).toBeVisible();
    await page.getByRole("button", { name: "Confirm 40 Customers" }).click();

    await expect(page.getByRole("heading", { name: "Review Customers import" })).toHaveCount(0);
    await expect(page.getByRole("status")).toContainText("Imported 0 · Needs review 0 · Failed 40");
    await expect(page.getByRole("alert")).toContainText("Import stopped because the active workspace is not available");
    expect(postAttempts).toBeGreaterThan(0);
    expect(postAttempts).toBeLessThanOrEqual(8);
  });

  for (const register of registers) {
    test(`${register.label} import validates, retries lost replies and preserves duplicate errors`, async ({ page }) => {
      test.setTimeout(120_000);
      await signIn(page);
      await page.goto(`/${register.entity}`);
      await expect(page.getByRole("button", { name: `Import ${register.label}` })).toBeEnabled();
      const workspaceId = await currentWorkspace(page);
      const token = `${register.entity}-${Date.now()}`;
      const name = `000 Retry ${token}`;
      const key = register.entity === "customers" ? `${token}@example.invalid` : token;
      const numeric = register.entity === "products" ? ",unit_cost" : register.entity === "services" ? ",duration_minutes" : "";
      const validValue = register.entity === "products" ? ",10.50" : register.entity === "services" ? ",45" : "";
      const invalidKey = register.entity === "customers" ? "invalid-email" : `${token}-invalid`;
      const invalidValue = register.entity === "products" ? ",abc" : register.entity === "services" ? ",2" : "";
      const csv = `name,${register.keyHeading}${numeric}\n${name},${key}${validValue}\nInvalid ${token},${invalidKey}${invalidValue}\n`;
      const attempts: Array<{ body: Record<string, unknown>; key: string | undefined }> = [];
      let dropReply = true;
      await page.route(`**/api/${register.entity}`, async (route) => {
        if (route.request().method() !== "POST") return route.continue();
        attempts.push({ body: route.request().postDataJSON(), key: route.request().headers()["idempotency-key"] });
        if (dropReply) {
          dropReply = false;
          const committed = await route.fetch();
          expect(committed.ok()).toBeTruthy();
          // The real canonical command committed. Only its response is lost.
          return route.abort("failed");
        }
        return route.continue();
      });
      await uploadCsv(page, csv);
      await expect(page.getByText("Rows excluded from this import")).toBeVisible();
      expect(attempts).toHaveLength(0);
      expect(await persistedRows(page, register.entity, workspaceId, name)).toHaveLength(0);
      await confirmImportAndWaitForRegister(page, `Confirm 1 ${register.label}`);
      await expect(page.getByRole("status")).toContainText(
        register.entity === "customers"
          ? "Imported 1 · Needs review 1 · Failed 0"
          : "Imported 1 · Needs review 0 · Failed 1",
      );
      expect(attempts).toHaveLength(2);
      expect(attempts[1]).toEqual(attempts[0]);
      expect(attempts[0].key).toBeTruthy();
      if (register.entity === "products") {
        for (const field of ["quantity", "stock", "openingStock", "openingQuantity"]) expect(attempts[0].body).not.toHaveProperty(field);
      }
      const firstRows = await persistedRows(page, register.entity, workspaceId, name);
      expect(firstRows).toHaveLength(1);

      await uploadCsv(page, csv);
      await confirmImportAndWaitForRegister(page, `Confirm 1 ${register.label}`);
      expect(attempts).toHaveLength(3);
      expect(attempts[2]).toEqual(attempts[0]);
      expect((await persistedRows(page, register.entity, workspaceId, name)).map((row) => row.id)).toEqual(firstRows.map((row) => row.id));

      await uploadCsv(page, `name,${register.keyHeading}${numeric}\nDifferent ${token},${key}${validValue}\n`);
      await confirmImportAndWaitForRegister(page, `Confirm 1 ${register.label}`);
      await expect(page.getByRole("status")).toContainText(
        register.entity === "customers"
          ? "Imported 0 · Needs review 1 · Failed 0"
          : "Imported 0 · Needs review 0 · Failed 1",
      );
      expect(attempts).toHaveLength(4); // A definite rejection is not automatically retried.
      expect(await persistedRows(page, register.entity, workspaceId, `Different ${token}`)).toHaveLength(0);
      if (register.entity === "customers") {
        await page.getByRole("button", { name: "Review", exact: true }).first().click();
        await expect(page.getByText("Import review", { exact: true }).first()).toBeVisible();
        await page.locator("tbody tr").filter({ hasText: `Different ${token}` }).getByRole("button", { name: "Review", exact: true }).click();
        await expect(page.getByText("Possible duplicate Customer", { exact: false })).toBeVisible();
      }
    });

    test(`${register.label} pagination retains the first page without duplicates`, async ({ page }) => {
      test.setTimeout(120_000);
      await signIn(page);
      await page.goto(`/${register.entity}`);
      await expect(page.getByRole("button", { name: `Import ${register.label}` })).toBeEnabled();
      const prefix = `Page ${register.entity} ${Date.now()}`;
      const csv = `name,${register.keyHeading}\n` + Array.from({ length: 101 }, (_, index) => {
        const suffix = String(index).padStart(3, "0");
        const key = register.entity === "customers" ? `page-${Date.now()}-${suffix}@example.invalid` : `${Date.now()}-${suffix}`;
        return `${prefix} ${suffix},${key}`;
      }).join("\n");
      await uploadCsv(page, csv);
      await confirmImportAndWaitForRegister(page, `Confirm 101 ${register.label}`);
      await page.getByLabel(register.search).fill(prefix);
      const rows = page.locator("tbody tr");
      const firstPageSize = register.entity === "customers" ? 50 : 100;
      await expect(rows).toHaveCount(firstPageSize, { timeout: 15_000 });
      const firstPage = await rows.allTextContents();
      if (register.entity === "customers") {
        const nextPage = page.getByRole("button", { name: "Next Customer page", exact: true });
        await expect(nextPage).toBeEnabled();
        await nextPage.click();
        await expect(page.getByRole("button", { name: "Customer page 2", exact: true })).toHaveAttribute("aria-current", "page");
        await expect(rows).toHaveCount(50);
        const secondPage = await rows.allTextContents();
        expect(secondPage).not.toEqual(firstPage);
        const previousPage = page.getByRole("button", { name: "Previous Customer page", exact: true });
        await expect(previousPage).toBeEnabled();
        await previousPage.click();
        await expect(page.getByRole("button", { name: "Customer page 1", exact: true })).toHaveAttribute("aria-current", "page");
        await expect(rows).toHaveCount(50);
        expect(await rows.allTextContents()).toEqual(firstPage);
      } else {
        await expect(page.getByRole("button", { name: register.next, exact: true })).toBeEnabled();
        await page.getByRole("button", { name: register.next, exact: true }).click();
        await expect(rows).toHaveCount(101);
        const allRows = await rows.allTextContents();
        expect(allRows.slice(0, 100)).toEqual(firstPage);
        expect(new Set(allRows).size).toBe(101);
        await expect(page.getByRole("button", { name: register.next, exact: true })).toHaveCount(0);
      }
    });

    test(`${register.label} manual creation and offline lifecycle replay persist canonically`, async ({ page, context }) => {
      test.setTimeout(120_000);
      await signIn(page);
      await page.goto(`/${register.entity}`);
      await expect(page.getByRole("button", { name: `Import ${register.label}` })).toBeEnabled();
      const workspaceId = await currentWorkspace(page);
      const name = `Offline ${register.singular} ${Date.now()}`;
      const prefix = `bdb-${register.singular.toLowerCase()}-queue-v1:${workspaceId}`;
      const queued = () => page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "[]"), prefix);
      const reconnect = async () => {
        await context.setOffline(false);
        await expect.poll(queued, { timeout: 30_000 }).toEqual([]);
      };
      try {
        await context.setOffline(true);
        await page.getByRole("button", { name: new RegExp(`^add ${register.singular}$`, "i") }).first().click();
        await page.getByLabel(`${register.singular} name`, { exact: true }).fill(name);
        if (register.entity === "products") {
          await page.getByLabel("SKU / stock code").fill(`OFF-${Date.now()}`);
          await page.getByLabel("Barcode", { exact: true }).fill(`BAR-${Date.now()}`);
          await expect(page.getByRole("button", { name: /^Scan$/ })).toHaveCount(0);
          await expect(page.getByLabel("Supplier", { exact: true })).toHaveCount(0);
        }
        if (register.entity === "services") await page.getByLabel("Service code").fill(`OFF-${Date.now()}`);
        await page.getByRole("button", { name: new RegExp(`^create ${register.singular}$`, "i") }).click();
        await expect.poll(async () => (await queued()).length).toBe(1);
        await reconnect();
        expect(await persistedRows(page, register.entity, workspaceId, name)).toHaveLength(1);
        await page.getByLabel(register.search).fill(name);
        let row = await waitForRecordRow(page, name);
        await expect(row.getByRole("button", { name: "Edit" })).toBeEnabled();

        await context.setOffline(true);
        await row.getByRole("button", { name: "Edit" }).click();
        const updated = `${name} Updated`;
        await page.getByLabel(`${register.singular} name`, { exact: true }).fill(updated);
        await page.getByRole("button", { name: "Save changes" }).click();
        await expect.poll(async () => (await queued()).length).toBe(1);
        await reconnect();
        expect((await persistedRows(page, register.entity, workspaceId, updated))[0].name).toBe(updated);
        row = await waitForRecordRow(page, updated);
        await expect(row.getByRole("button", { name: "Archive" })).toBeEnabled();

        await context.setOffline(true);
        await row.getByRole("button", { name: "Archive" }).click();
        await expect.poll(async () => (await queued()).length).toBe(1);
        await reconnect();
        expect(await persistedRows(page, register.entity, workspaceId, updated)).toHaveLength(0);
        expect(await persistedRows(page, register.entity, workspaceId, updated, true)).toHaveLength(1);
        await page.getByRole("button", { name: "Archived", exact: true }).click();
        row = await waitForRecordRow(page, updated);
        await expect(row.getByRole("button", { name: "Restore" })).toBeEnabled();

        await context.setOffline(true);
        await row.getByRole("button", { name: "Restore" }).click();
        await expect.poll(async () => (await queued()).length).toBe(1);
        await reconnect();
        expect(await persistedRows(page, register.entity, workspaceId, updated)).toHaveLength(1);
        await page.getByRole("button", { name: register.active, exact: true }).click();
        await waitForRecordRow(page, updated);
      } finally {
        await context.setOffline(false);
      }
    });
  }

  test("Customer XLSX accepts full-name headings and rejects unknown or oversized workbooks", async ({ page }) => {
    await signIn(page);
    await page.goto("/customers");
    await expect(page.getByRole("button", { name: "Import Customers" })).toBeEnabled();
    const input = page.locator('input[type="file"][accept*=".xlsx"]');
    const upload = (buffer: string) => input.setInputFiles({ name: "synthetic-customer-case.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: Buffer.from(buffer, "base64") });
    await upload(CUSTOMER_XLSX_CASES.fullName);
    await expect(page.getByText("Maya Test").first()).toBeVisible();
    await expect(page.getByText("Hidden Person")).toHaveCount(0);
    await confirmImportAndWaitForRegister(page, "Confirm 1 Customers");
    await page.getByLabel("Search Customers").fill("Maya Test");
    const row = await waitForRecordRow(page, "Maya Test");
    await expect(row).toContainText("+356 70000009");
    const workspaceId = await currentWorkspace(page);
    expect(await persistedRows(page, "customers", workspaceId, "Hidden Person")).toHaveLength(0);
    let writes = 0;
    page.on("request", (request) => { if (request.method() === "POST" && new URL(request.url()).pathname === "/api/customers") writes += 1; });
    await upload(CUSTOMER_XLSX_CASES.unknown);
    await expect(page.getByRole("alert")).toContainText("could not find a visible worksheet with recognised Customer columns");
    await expect(page.getByRole("heading", { name: "Review Customers import" })).toHaveCount(0);
    await upload(CUSTOMER_XLSX_CASES.ambiguous);
    await expect(page.getByRole("alert")).toContainText("multiple equally likely Customer worksheets");
    await expect(page.getByRole("heading", { name: "Review Customers import" })).toHaveCount(0);
    await upload(CUSTOMER_XLSX_CASES.oversized);
    await expect(page.getByRole("alert")).toContainText("expands beyond the supported import size");
    expect(writes).toBe(0);
  });

  test("Accounts journeys stay in the consolidated workspaces", async ({ page }) => {
    await signIn(page);

    await page.goto("/accounts");
    await expect(page.getByRole("heading", { name: "Financial control without the clutter" })).toBeVisible();
    await page.locator('a[href="/accounts/sales"]').first().click();
    await expect(page).toHaveURL(/\/accounts\/sales$/);
    await expect(page.getByRole("heading", { name: "Sales documents", level: 1 })).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(/\/accounts$/);
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
