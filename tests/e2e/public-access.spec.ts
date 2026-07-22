import { test, expect } from "@playwright/test";

test("login page is available", async ({ page }) => {
  const response = await page.goto("/login");
  expect(response?.ok()).toBeTruthy();
  await expect(page.getByRole("heading", { name: "Welcome back." })).toBeVisible();
});

test("protected workspace never exposes data without verified configuration and access", async ({ page }) => {
  const response = await page.goto("/workspace");
  expect(response).not.toBeNull();

  if (response?.status() === 503) {
    await expect(page.getByText("BDB OS is temporarily unavailable. No workspace data has been loaded.", { exact: true })).toBeVisible();
    return;
  }

  expect(response?.ok()).toBeTruthy();
  await expect(page).toHaveURL(/\/login(?:\?|$)/);
  await expect(page.getByRole("heading", { name: "Welcome back." })).toBeVisible();
  await expect(page.getByText("Local preview", { exact: true })).toHaveCount(0);
});

test("Solo Operator preview hydrates into the simplified operating experience", async ({ page }) => {
  const response = await page.goto("/solo-operator-preview");
  expect(response?.ok()).toBeTruthy();

  await expect(page.getByRole("heading", { name: "Good morning, Alex. Here is what deserves you." })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Solo Operator navigation" })).toBeVisible();
  await expect(page.getByText("Approval-first operator", { exact: true })).toBeVisible();
  await expect(page.getByText("Review environment only", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /^Operator$/ }).click();
  await expect(page.getByRole("heading", { name: "Operator control room" })).toBeVisible();
  await expect(page.getByText("Simulation only", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Verified time returned", { exact: true })).toBeVisible();
  await expect(page.getByText("Business departments", { exact: true })).toHaveCount(0);
});

test("marketing and discovery present a truthful, durable commercial journey", async ({ page }) => {
  const response = await page.goto("/");
  expect(response?.ok()).toBeTruthy();
  await expect(page.getByRole("heading", { name: "Your business, finally working as one." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Solo Operator" })).toBeVisible();
  await page.getByRole("link", { name: "Discuss Solo Operator" }).click();
  await expect(page).toHaveURL(/\/discovery\?plan=solo-operator/);
  await expect(page.getByLabel("Starting plan")).toHaveValue("solo-operator");

  let submitted: Record<string, unknown> | null = null;
  await page.route("**/api/discovery", async (route) => {
    submitted = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ ok: true, receipt: "test-receipt" }) });
  });
  await page.getByLabel("Your name").fill("Jamie Taylor");
  await page.getByLabel("Business name").fill("Taylor Studio");
  await page.getByLabel("Work email").fill("jamie@example.com");
  await page.getByLabel("Business sector").selectOption("wellness");
  await page.getByLabel("What is taking too much time right now?").fill("Chasing appointment reminders and overdue invoices takes several hours every week.");
  await page.getByRole("button", { name: "Send enquiry" }).click();
  await expect(page.getByRole("heading", { name: "Thanks—that gives us a useful starting point." })).toBeVisible();
  expect(submitted?.startingPlan).toBe("solo-operator");
  expect(submitted?.sector).toBe("wellness");
});

test("Founder Sales inbox remains protected", async ({ page }) => {
  const response = await page.goto("/admin/enquiries");
  expect(response).not.toBeNull();
  if (response?.status() === 503) return;
  expect(response?.ok()).toBeTruthy();
  await expect(page).toHaveURL(/\/login(?:\?|$)|\/mfa(?:\?|$)/);
});

test("protected Solo Operator never exposes workspace records without verified access", async ({ page }) => {
  const response = await page.goto("/solo-operator");
  expect(response).not.toBeNull();

  if (response?.status() === 503) {
    await expect(page.getByText("BDB OS is temporarily unavailable. No workspace data has been loaded.", { exact: true })).toBeVisible();
    return;
  }

  expect(response?.ok()).toBeTruthy();
  await expect(page).toHaveURL(/\/login(?:\?|$)/);
  await expect(page.getByRole("heading", { name: "Welcome back." })).toBeVisible();
});

test("invalid invitation callback fails safely", async ({ page }) => {
  await page.goto("/auth/callback?next=/activate");
  await expect(page.getByRole("heading", { name: "Invitation unavailable" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Return to sign in" })).toBeVisible();
});

test("security headers are present", async ({ request }) => {
  const response = await request.get("/login");
  expect(response.headers()["x-content-type-options"]).toBe("nosniff");
  expect(response.headers()["x-frame-options"]).toBe("DENY");
  expect(response.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
});
