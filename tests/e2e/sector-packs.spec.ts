import { test, expect } from "@playwright/test";

test("Sector Pack founder preview renders without client workspace data", async ({ page }) => {
  const response = await page.goto("/sector-packs-preview");
  expect(response?.ok()).toBeTruthy();
  await expect(page.getByRole("heading", { name: "One operating system. Purpose-built for each client." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Harbour Health Clinic" })).toBeVisible();
  await expect(page.getByText("Healthcare Practice", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Preview only", { exact: true })).toBeVisible();
  await expect(page.getByText("Loading secure control plane", { exact: false })).toHaveCount(0);
});

test("Founder Sector Pack editor remains protected", async ({ page }) => {
  const response = await page.goto("/admin/sector-packs");
  expect(response).not.toBeNull();

  if (response?.status() === 503) {
    await expect(page.getByText("BDB OS is temporarily unavailable. No workspace data has been loaded.", { exact: true })).toBeVisible();
    return;
  }

  expect(response?.ok()).toBeTruthy();
  await expect(page).toHaveURL(/\/login(?:\?|$)|\/mfa(?:\?|$)/);
  await expect(page.getByText("Configure the client, not another codebase.", { exact: true })).toHaveCount(0);
});
