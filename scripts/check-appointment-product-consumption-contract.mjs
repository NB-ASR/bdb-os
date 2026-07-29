import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration = await readFile("supabase/migrations/20260729150000_appointment_product_consumption.sql", "utf8");
const inventoryApi = await readFile("src/app/api/inventory/route.ts", "utf8");
const bundleApi = await readFile("src/app/api/appointment-consumption/route.ts", "utf8");
const page = await readFile("src/app/inventory/appointment-consumption/page.tsx", "utf8");
const queue = await readFile("src/lib/modules/inventory-queue.ts", "utf8");
const inventoryLayout = await readFile("src/app/inventory/layout.tsx", "utf8");
const calendarLayout = await readFile("src/app/calendar/layout.tsx", "utf8");

assert.match(migration, /add column appointment_id uuid/i, "Inventory movements need a canonical Appointment link.");
assert.match(migration, /references public\.bookings\(workspace_id, id\)/i, "Appointment consumption must reference canonical Appointments.");
assert.match(migration, /inventory_movements_appointment_shape/i, "Appointment movement shape constraint is missing.");
assert.match(migration, /movement_type = 'appointment_consumption'[\s\S]*must be recorded as internal consumption/i, "Legacy Appointment movement types must be rejected.");
assert.match(migration, /create or replace function public\.post_appointment_product_consumption/i, "Trusted consumption command is missing.");
assert.match(migration, /create or replace function public\.reverse_appointment_product_consumption/i, "Trusted consumption reversal is missing.");
assert.match(migration, /appointment\.status::text = 'completed'/i, "Consumption must require a completed Appointment.");
assert.match(migration, /product_record\.purpose <> 'supply'/i, "Consumption must accept supply Products only.");
assert.match(migration, /Resale Products must leave Inventory through a completed Sale/i, "Resale boundary is missing.");
assert.match(migration, /'internal_consumption'/i, "Supply usage must use the internal-consumption movement type.");
assert.match(migration, /actor_has_workspace_permission[\s\S]*'inventory'[\s\S]*'create'/i, "Consumption posting must use Inventory permissions.");
assert.match(migration, /actor_has_workspace_permission[\s\S]*'inventory'[\s\S]*'edit'/i, "Consumption reversal must use Inventory permissions.");
assert.match(migration, /inventory_command_receipts/i, "Consumption commands must be idempotent.");
assert.match(migration, /activity_items/i, "Consumption commands must write Activity history.");
assert.doesNotMatch(migration, /insert into public\.(sales|sale_lines|invoices|bank_transactions)/i, "Consumption must not create commercial or Banking records.");
assert.match(migration, /reversal_of_id/i, "Consumption corrections must be immutable reversals.");
assert.match(migration, /grant execute[\s\S]*to service_role/i, "Only the trusted server role may execute consumption commands.");

assert.match(inventoryApi, /post-appointment-consumption/i, "Inventory API must expose the consumption command.");
assert.match(inventoryApi, /reverse-appointment-consumption/i, "Inventory API must expose the reversal command.");
assert.match(inventoryApi, /post_appointment_product_consumption/i, "Inventory API must call the trusted post function.");
assert.match(inventoryApi, /reverse_appointment_product_consumption/i, "Inventory API must call the trusted reversal function.");
assert.match(inventoryApi, /sourceType === "appointment_consumption"/i, "Generic manual movements must reserve the Appointment source type.");
assert.match(inventoryApi, /APPOINTMENT_CONSUMPTION_RESALE_REQUIRES_SALE/i, "Resale misuse needs a distinct operational error.");

assert.match(bundleApi, /\.eq\("status", "completed"\)/i, "Read bundle must expose completed Appointments only.");
assert.match(bundleApi, /\.eq\("purpose", "supply"\)/i, "Read bundle must expose supply Products only.");
assert.match(bundleApi, /\.eq\("source_type", "appointment_consumption"\)/i, "Read bundle must expose linked consumption movements only.");
assert.match(bundleApi, /get_effective_features/i, "Consumption bundle must enforce feature availability.");

assert.match(queue, /post-appointment-consumption/i, "Shared Inventory queue must accept consumption posts.");
assert.match(queue, /reverse-appointment-consumption/i, "Shared Inventory queue must accept consumption reversals.");
assert.match(page, /enqueueInventoryCommand/i, "Consumption UI must use the shared Inventory queue.");
assert.match(page, /Saved offline/i, "Consumption UI must state its offline behaviour.");
assert.match(page, /Recorded stock will become negative/i, "Negative stock discrepancies must remain visible rather than hiding actual usage.");
assert.match(page, /resale Products leave stock only through a completed Sale/i, "UI must preserve the resale boundary.");
assert.match(page, /Original movements preserved/i, "UI must describe immutable reversal behaviour.");
assert.match(inventoryLayout, /Appointment usage/i, "Consumption must be discoverable from Inventory.");
assert.match(calendarLayout, /Product usage/i, "Consumption must be discoverable from Calendar.");

console.log("Appointment Product consumption contracts are intact.");
