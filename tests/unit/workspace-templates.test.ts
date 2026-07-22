import test from "node:test";
import assert from "node:assert/strict";
import {
  getTemplateTerminology,
  getWorkspaceModules,
  resolveIndustryTemplate,
} from "../../src/lib/workspace-templates.ts";
import {
  inventoryStockStatus,
  lowStockItems,
  suggestedReorderQuantity,
  summariseInventory,
  type InventoryItemSnapshot,
} from "../../src/lib/modules/inventory.ts";

const vanitaItems: InventoryItemSnapshot[] = [
  {
    id: "serum",
    name: "Hydra Serum",
    sku: "SERUM-01",
    quantity: 1,
    reorderPoint: 2,
    targetQuantity: 5,
    unitCost: 25,
    unitPrice: 42,
    purpose: "resale",
  },
  {
    id: "gloves",
    name: "Treatment Gloves",
    sku: "GLOVE-01",
    quantity: 0,
    reorderPoint: 10,
    targetQuantity: 50,
    unitCost: 0.2,
    purpose: "consumable",
  },
  {
    id: "inactive",
    name: "Retired Product",
    sku: "OLD-01",
    quantity: 20,
    reorderPoint: 2,
    targetQuantity: 10,
    unitCost: 5,
    unitPrice: 10,
    purpose: "resale",
    active: false,
  },
];

test("general workspaces expose only currently available modules", () => {
  const modules = getWorkspaceModules("general");
  assert.ok(modules.length > 0);
  assert.equal(modules.some((module) => module.id === "inventory"), true);
  assert.equal(modules.some((module) => module.availability !== "available"), false);
});

test("beauty and wellness template activates Inventory and recommends reusable Sales", () => {
  const template = resolveIndustryTemplate("beauty-wellness");
  assert.deepEqual(template.recommendedModules, ["sales"]);
  assert.equal(template.activeModules.includes("inventory"), true);
  assert.equal(template.exampleWorkspace, "Vanita Beauty and Wellness Spa");
  assert.equal(getTemplateTerminology(template.id, "customer"), "Client");
  assert.equal(getTemplateTerminology(template.id, "service"), "Treatment");
});

test("unknown template identifiers fail safely to the general template", () => {
  assert.equal(resolveIndustryTemplate("unknown-template").id, "general");
});

test("inventory status and reorder rules are independent of Vanita-specific data", () => {
  assert.equal(inventoryStockStatus(vanitaItems[0]), "low-stock");
  assert.equal(inventoryStockStatus(vanitaItems[1]), "out-of-stock");
  assert.equal(suggestedReorderQuantity(vanitaItems[0]), 4);
  assert.equal(suggestedReorderQuantity(vanitaItems[1]), 50);
});

test("inventory summaries separate consumable cost from resale revenue", () => {
  const summary = summariseInventory(vanitaItems);
  assert.deepEqual(summary, {
    activeItemCount: 2,
    totalUnits: 1,
    lowStockItemCount: 1,
    outOfStockItemCount: 1,
    costValue: 25,
    potentialResaleRevenue: 42,
  });

  assert.deepEqual(lowStockItems(vanitaItems).map((item) => item.id), ["gloves", "serum"]);
});
