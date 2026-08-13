import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const migration = await readFile(
  "supabase/release-sources/vanita-integration-20260813/20260728160000_purchasing_create_products_from_invoice.sql",
  "utf8",
);
const route = await readFile(
  "src/app/api/purchasing/documents/[documentId]/route.ts",
  "utf8",
);

test("unmatched invoice lines default to deterministic new Product proposals", () => {
  assert.match(route, /const proposedProductId = line\.id/);
  assert.match(route, /Create new Product/);
  assert.match(route, /matched_product_id: proposedProductId/);
  assert.match(route, /proposed_new_product: true/);
});

test("approval normalizes older cached unmatched Product lines", () => {
  assert.match(route, /function normaliseReviewLines/);
  assert.match(route, /action === "approve"[\s\S]*lineKind === "product"/);
  assert.match(route, /line\.matchedProductId = lineId/);
  assert.match(route, /p_lines: reviewedLines/);
});

test("approval creates Products and Supplier relationships atomically", () => {
  assert.match(migration, /product_uuid <> line_uuid/);
  assert.match(migration, /insert into public\.products/);
  assert.match(migration, /insert into public\.product_suppliers/);
  assert.match(migration, /Product created from supplier document/);
  assert.match(migration, /Product supplier linked from supplier document/);
  assert.match(migration, /createdProductCount/);
  assert.match(migration, /createdRelationshipCount/);
});

test("invoice Product creation preserves duplicate and retry controls", () => {
  assert.match(migration, /supplier_document_command_receipts/);
  assert.match(migration, /if previous_result is not null then return previous_result/);
  assert.match(migration, /existing Product already uses this barcode/i);
  assert.match(migration, /Supplier SKU is already linked to another Product/i);
  assert.match(migration, /workspace_id = p_workspace_id and product\.sku = product_sku/);
});
