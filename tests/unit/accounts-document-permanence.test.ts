import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(path: string) {
  return readFile(path, "utf8");
}

test("Pass 2 migration captures mutable document identity at issue time", async () => {
  const migration = await source("supabase/migrations/20260821132000_accounts_document_permanence.sql");

  for (const field of [
    "supplier_email_snapshot",
    "supplier_phone_snapshot",
    "document_footer_snapshot",
    "document_permanence_snapshot_at",
  ]) assert.match(migration, new RegExp(field));

  for (const field of [
    "supplier_name_snapshot",
    "supplier_address_snapshot",
    "supplier_vat_number_snapshot",
    "supplier_registration_number_snapshot",
    "customer_address_snapshot",
    "customer_vat_number_snapshot",
  ]) assert.match(migration, new RegExp(`delivery_notes[\\s\\S]*${field}`));

  assert.match(migration, /snapshot_invoice_document_permanence/);
  assert.match(migration, /snapshot_credit_note_document_permanence/);
  assert.match(migration, /snapshot_delivery_note_document_permanence/);
  assert.match(migration, /old\.status::text <> 'draft'/);
  assert.match(migration, /old\.status = 'issued'/);
});

test("issued document rendering switches from live values to permanent snapshots", async () => {
  const route = await source("src/app/api/business-documents/render/route.ts");

  assert.match(route, /const snapshotReady = !draft && Boolean\(row\.document_permanence_snapshot_at\)/);
  assert.match(route, /permanentValue\(snapshotReady, row\.supplier_email_snapshot, settings\.email\)/);
  assert.match(route, /permanentValue\(snapshotReady, row\.supplier_phone_snapshot, settings\.phone\)/);
  assert.match(route, /permanentValue\(snapshotReady, row\.document_footer_snapshot, settings\.document_footer\)/);
  assert.match(route, /permanentValue\(snapshotReady, row\.supplier_address_snapshot, settings\.business_address\)/);
  assert.match(route, /permanentValue\(snapshotReady, row\.customer_address_snapshot, customerResult\.data\?\.address\)/);
  assert.doesNotMatch(route, /row\.supplier_email_snapshot \?\? settings\.email/);
  assert.doesNotMatch(route, /row\.document_footer_snapshot \?\? settings\.document_footer/);
});

test("Pass 2 does not change financial totals or balance rendering", async () => {
  const [migration, route] = await Promise.all([
    source("supabase/migrations/20260821132000_accounts_document_permanence.sql"),
    source("src/app/api/business-documents/render/route.ts"),
  ]);

  assert.match(route, /totalAmount: num\(row\.total_amount\)/);
  assert.doesNotMatch(route, /totalAmount: num\(row\.adjusted_total_amount/);
  assert.doesNotMatch(migration, /update public\.invoices[\s\S]*total_amount\s*=/i);
  assert.doesNotMatch(migration, /update public\.credit_notes[\s\S]*total_amount\s*=/i);
});
