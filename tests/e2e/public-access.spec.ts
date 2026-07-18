import { test, expect } from "@playwright/test";

test("login page is available", async ({ page }) => {
  const response = await page.goto("/login");
  expect(response?.ok()).toBeTruthy();
  await expect(page.getByRole("heading", { name: "Welcome back." })).toBeVisible();
});

test("protected workspace redirects anonymous users to sign in", async ({ page }) => {
  await page.goto("/workspace");
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole("button", { name: /sign in/i })).toBeVisible();
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
