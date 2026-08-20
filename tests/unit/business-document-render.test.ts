import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Invoice renderers use plain Subtotal wording and PDF-safe empty discounts", async () => {
  const renderer = await readFile("src/lib/server/business-document-render.ts", "utf8");

  assert.doesNotMatch(renderer, /Subtotal after discount/);
  assert.ok(renderer.includes('document.kind === "credit_note" ? "Credit subtotal" : "Subtotal"'));
  assert.ok(renderer.includes('.replace(/[–—]/g, "-")'));
});
