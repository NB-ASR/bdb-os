import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration = await readFile(
  "supabase/migrations/20260727161000_supplier_document_capture_review.sql",
  "utf8",
);
const uploadApi = await readFile("src/app/api/purchasing/documents/route.ts", "utf8");
const extractionApi = await readFile(
  "src/app/api/purchasing/documents/[documentId]/extract/route.ts",
  "utf8",
);
const reviewApi = await readFile(
  "src/app/api/purchasing/documents/[documentId]/route.ts",
  "utf8",
);
const workspace = await readFile(
  "src/app/documents/purchasing/purchasing-workspace.tsx",
  "utf8",
);

for (const table of [
  "supplier_documents",
  "supplier_document_lines",
  "supplier_document_extraction_runs",
  "supplier_document_command_receipts",
]) {
  assert.match(migration, new RegExp(`create table public\\.${table}`), `${table} is missing.`);
}

assert.match(migration, /file_path like workspace_id::text/);
assert.match(migration, /file_sha256 ~ '\^\[0-9a-f\]\{64\}\$'/);
assert.match(migration, /supplier_documents_workspace_hash_idx/);
assert.match(migration, /supplier_documents_workspace_number_idx/);
assert.match(migration, /inventory_posting_status = 'not_available'/);
assert.match(migration, /accounts_posting_status = 'not_available'/);
assert.match(migration, /platform_support_sessions/);
assert.match(migration, /Supplier document write access denied/);
assert.match(migration, /Approved or archived supplier documents cannot be edited/);
assert.match(migration, /Every Product line must be matched before approval/);
assert.match(migration, /enable row level security/);
assert.match(migration, /grant select on public\.supplier_documents to authenticated/);
assert.match(migration, /grant select on public\.supplier_document_lines to authenticated/);
assert.doesNotMatch(migration, /grant (insert|update|delete).*supplier_documents to authenticated/i);
assert.match(migration, /grant execute on function public\.apply_supplier_document_upload/);
assert.match(migration, /to service_role/);

assert.match(uploadApi, /createHash\("sha256"\)/);
assert.match(uploadApi, /detectFileType/);
assert.match(uploadApi, /workspace-documents/);
assert.match(uploadApi, /requireWorkspaceCommand/);
assert.match(uploadApi, /context\.idempotencyKey/);
assert.match(uploadApi, /IDEMPOTENCY_REQUIRED/);
assert.match(uploadApi, /apply_supplier_document_upload/);

assert.match(extractionApi, /store: false/);
assert.match(extractionApi, /json_schema/);
assert.match(extractionApi, /complete_supplier_document_extraction/);
assert.match(extractionApi, /begin_supplier_document_extraction/);
assert.match(extractionApi, /fail_supplier_document_extraction/);
assert.match(extractionApi, /input_file|input_image/);

assert.match(reviewApi, /apply_supplier_document_review/);
assert.match(reviewApi, /expectedVersion/);
assert.match(reviewApi, /save_review/);
assert.match(reviewApi, /approve/);

assert.match(workspace, /indexedDB/);
assert.match(workspace, /syncInFlight/);
assert.match(workspace, /Review draft saved locally/);
assert.match(workspace, /Approval requires an internet connection/);
assert.match(workspace, /Inventory posting/);
assert.match(workspace, /Accounts posting/);
assert.match(workspace, /Discard review drafts/);

console.log("Purchasing document capture contract is intact.");
