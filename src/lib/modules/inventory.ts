export type InventoryItemPurpose = "resale" | "consumable";
export type InventoryStockStatus = "in-stock" | "low-stock" | "out-of-stock";

export interface InventoryItemSnapshot {
  id: string;
  name: string;
  sku: string;
  quantity: number;
  reorderPoint: number;
  targetQuantity: number;
  unitCost: number;
  unitPrice?: number;
  purpose: InventoryItemPurpose;
  active?: boolean;
}

export interface InventorySummary {
  activeItemCount: number;
  totalUnits: number;
  lowStockItemCount: number;
  outOfStockItemCount: number;
  costValue: number;
  potentialResaleRevenue: number;
}

function nonNegative(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, value);
}

export function inventoryStockStatus(item: InventoryItemSnapshot): InventoryStockStatus {
  const quantity = nonNegative(item.quantity);
  const reorderPoint = nonNegative(item.reorderPoint);

  if (quantity === 0) return "out-of-stock";
  if (quantity <= reorderPoint) return "low-stock";
  return "in-stock";
}

export function suggestedReorderQuantity(item: InventoryItemSnapshot): number {
  const quantity = nonNegative(item.quantity);
  const targetQuantity = nonNegative(item.targetQuantity);
  return Math.max(0, targetQuantity - quantity);
}

export function lowStockItems(items: readonly InventoryItemSnapshot[]): InventoryItemSnapshot[] {
  return items
    .filter((item) => item.active !== false)
    .filter((item) => inventoryStockStatus(item) !== "in-stock")
    .sort((left, right) => {
      const statusOrder: Record<InventoryStockStatus, number> = {
        "out-of-stock": 0,
        "low-stock": 1,
        "in-stock": 2,
      };
      const statusDifference = statusOrder[inventoryStockStatus(left)] - statusOrder[inventoryStockStatus(right)];
      if (statusDifference !== 0) return statusDifference;
      return nonNegative(left.quantity) - nonNegative(right.quantity);
    });
}

export function summariseInventory(items: readonly InventoryItemSnapshot[]): InventorySummary {
  const activeItems = items.filter((item) => item.active !== false);

  return activeItems.reduce<InventorySummary>((summary, item) => {
    const quantity = nonNegative(item.quantity);
    const unitCost = nonNegative(item.unitCost);
    const unitPrice = nonNegative(item.unitPrice ?? 0);
    const status = inventoryStockStatus(item);

    summary.activeItemCount += 1;
    summary.totalUnits += quantity;
    summary.costValue += quantity * unitCost;
    if (item.purpose === "resale") summary.potentialResaleRevenue += quantity * unitPrice;
    if (status === "low-stock") summary.lowStockItemCount += 1;
    if (status === "out-of-stock") summary.outOfStockItemCount += 1;

    return summary;
  }, {
    activeItemCount: 0,
    totalUnits: 0,
    lowStockItemCount: 0,
    outOfStockItemCount: 0,
    costValue: 0,
    potentialResaleRevenue: 0,
  });
}
