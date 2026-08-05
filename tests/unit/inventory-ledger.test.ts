import assert from "node:assert/strict";
import test from "node:test";
import {
  inventoryBalanceFor,
  inventoryBalances,
  inventoryStockStatus,
  normaliseInventoryMovementDelta,
  suggestedReorderQuantity,
  summariseInventory,
  type InventoryMovementSnapshot,
  type InventoryProductSnapshot,
} from "../../src/lib/modules/inventory.ts";

test("movement direction follows the owning business event", () => {
  assert.equal(normaliseInventoryMovementDelta("purchase_receipt", -4), 4);
  assert.equal(normaliseInventoryMovementDelta("customer_return", -2), 2);
  assert.equal(normaliseInventoryMovementDelta("sale", 3), -3);
  assert.equal(normaliseInventoryMovementDelta("supplier_return", 5), -5);
  assert.equal(normaliseInventoryMovementDelta("manual_adjustment", -1.2345), -1.235);
});

test("balances are reconstructed from immutable signed movements", () => {
  const movements: InventoryMovementSnapshot[] = [
    { id: "1", productId: "product", locationId: "main", movementType: "opening_balance", quantityDelta: 10, occurredAt: "2026-07-27T00:00:00Z" },
    { id: "2", productId: "product", locationId: "main", movementType: "transfer_out", quantityDelta: -3, occurredAt: "2026-07-27T01:00:00Z", transferGroupId: "transfer" },
    { id: "3", productId: "product", locationId: "store", movementType: "transfer_in", quantityDelta: 3, occurredAt: "2026-07-27T01:00:00Z", transferGroupId: "transfer" },
    { id: "4", productId: "product", locationId: "main", movementType: "write_off", quantityDelta: -2, occurredAt: "2026-07-27T02:00:00Z" },
    { id: "5", productId: "product", locationId: "main", movementType: "reversal", quantityDelta: 2, occurredAt: "2026-07-27T03:00:00Z", reversalOfId: "4" },
  ];
  const balances = inventoryBalances(movements);
  assert.equal(inventoryBalanceFor(balances, "product", "main"), 7);
  assert.equal(inventoryBalanceFor(balances, "product", "store"), 3);
  assert.equal(inventoryBalanceFor(balances, "product"), 10);
});

test("stock status exposes zero and negative stock rather than hiding it", () => {
  const base: InventoryProductSnapshot = {
    id: "product",
    name: "Product",
    sku: "SKU",
    purpose: "resale",
    quantity: 8,
    reorderLevel: 5,
    unitCost: 2,
    sellingPrice: 5,
  };
  assert.equal(inventoryStockStatus(base), "in-stock");
  assert.equal(inventoryStockStatus({ ...base, quantity: 5 }), "low-stock");
  assert.equal(inventoryStockStatus({ ...base, quantity: 0 }), "out-of-stock");
  assert.equal(inventoryStockStatus({ ...base, quantity: -2 }), "out-of-stock");
  assert.equal(suggestedReorderQuantity({ ...base, quantity: -2 }), 7);
});

test("summary derives valuation from the Product catalogue and excludes archived Products", () => {
  const summary = summariseInventory([
    {
      id: "resale",
      name: "Resale",
      sku: "RESALE",
      purpose: "resale",
      quantity: 4,
      reorderLevel: 2,
      unitCost: 3,
      sellingPrice: 8,
      status: "active",
    },
    {
      id: "supply",
      name: "Supply",
      sku: "SUPPLY",
      purpose: "supply",
      quantity: 1,
      reorderLevel: 2,
      unitCost: 5,
      sellingPrice: null,
      status: "active",
    },
    {
      id: "archived",
      name: "Archived",
      sku: "ARCHIVED",
      purpose: "resale",
      quantity: 100,
      reorderLevel: 10,
      unitCost: 20,
      sellingPrice: 40,
      status: "archived",
    },
  ]);
  assert.deepEqual(summary, {
    activeProductCount: 2,
    totalUnits: 5,
    lowStockProductCount: 1,
    outOfStockProductCount: 0,
    catalogueCostValue: 17,
    potentialResaleValue: 32,
  });
});
