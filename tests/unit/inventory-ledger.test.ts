import test from "node:test";
import assert from "node:assert/strict";
import {
  inventoryBalanceFor,
  inventoryBalances,
  inventoryStockStatus,
  normaliseInventoryMovementDelta,
  reverseInventoryMovement,
  suggestedReorderQuantity,
  summariseInventory,
  type InventoryMovementSnapshot,
} from "../../src/lib/modules/inventory.ts";

const movements: InventoryMovementSnapshot[] = [
  {
    id: "receipt",
    itemId: "serum",
    locationId: "main",
    movementType: "purchase_receipt",
    quantityDelta: 10,
    occurredAt: "2026-07-22T09:00:00.000Z",
  },
  {
    id: "sale",
    itemId: "serum",
    locationId: "main",
    movementType: "sale",
    quantityDelta: -3,
    occurredAt: "2026-07-22T10:00:00.000Z",
  },
  {
    id: "transfer-out",
    itemId: "serum",
    locationId: "main",
    movementType: "transfer_out",
    quantityDelta: -2,
    transferGroupId: "transfer",
    occurredAt: "2026-07-22T11:00:00.000Z",
  },
  {
    id: "transfer-in",
    itemId: "serum",
    locationId: "treatment-room",
    movementType: "transfer_in",
    quantityDelta: 2,
    transferGroupId: "transfer",
    occurredAt: "2026-07-22T11:00:00.000Z",
  },
];

test("stock is derived from append-only movements by item and location", () => {
  const balances = inventoryBalances(movements);
  assert.equal(inventoryBalanceFor(balances, "serum", "main"), 5);
  assert.equal(inventoryBalanceFor(balances, "serum", "treatment-room"), 2);
  assert.equal(inventoryBalanceFor(balances, "serum"), 7);
});

test("movement direction is normalised consistently", () => {
  assert.equal(normaliseInventoryMovementDelta("purchase_receipt", -4), 4);
  assert.equal(normaliseInventoryMovementDelta("write_off", 4), -4);
  assert.equal(normaliseInventoryMovementDelta("manual_adjustment", -1.25), -1.25);
  assert.equal(normaliseInventoryMovementDelta("manual_adjustment", 1.25), 1.25);
});

test("reversals negate the original movement without editing history", () => {
  const reversal = reverseInventoryMovement(movements[1], "reversal", "2026-07-22T12:00:00.000Z");
  assert.deepEqual(reversal, {
    id: "reversal",
    itemId: "serum",
    locationId: "main",
    movementType: "reversal",
    quantityDelta: 3,
    occurredAt: "2026-07-22T12:00:00.000Z",
    reversalOfId: "sale",
  });
  assert.equal(inventoryBalanceFor(inventoryBalances([...movements, reversal]), "serum"), 10);
});

test("negative stock remains visible and increases the reorder suggestion", () => {
  const item = {
    id: "gloves",
    name: "Treatment Gloves",
    sku: "GLOVE-01",
    quantity: -4,
    reorderPoint: 10,
    targetQuantity: 50,
    unitCost: 0.2,
    purpose: "consumable" as const,
  };

  assert.equal(inventoryStockStatus(item), "out-of-stock");
  assert.equal(suggestedReorderQuantity(item), 54);
  assert.equal(summariseInventory([item]).totalUnits, -4);
});

test("a reversal cannot itself be reversed", () => {
  assert.throws(
    () => reverseInventoryMovement({
      id: "reversal",
      itemId: "serum",
      locationId: "main",
      movementType: "reversal",
      quantityDelta: 3,
      occurredAt: "2026-07-22T12:00:00.000Z",
      reversalOfId: "sale",
    }, "second-reversal", "2026-07-22T13:00:00.000Z"),
    /cannot be reversed again/i,
  );
});
