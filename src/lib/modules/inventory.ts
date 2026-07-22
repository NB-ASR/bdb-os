export type InventoryItemPurpose = "resale" | "consumable";
export type InventoryStockStatus = "in-stock" | "low-stock" | "out-of-stock";
export type InventoryMovementType =
  | "opening_balance"
  | "purchase_receipt"
  | "sale"
  | "appointment_consumption"
  | "customer_return"
  | "supplier_return"
  | "transfer_out"
  | "transfer_in"
  | "manual_adjustment"
  | "write_off"
  | "reversal";

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

export interface InventoryMovementSnapshot {
  id: string;
  itemId: string;
  locationId: string;
  movementType: InventoryMovementType;
  quantityDelta: number;
  occurredAt: string;
  reversalOfId?: string;
  transferGroupId?: string;
  pending?: boolean;
}

export interface InventoryLocationBalance {
  itemId: string;
  locationId: string;
  quantity: number;
}

export interface InventorySummary {
  activeItemCount: number;
  totalUnits: number;
  lowStockItemCount: number;
  outOfStockItemCount: number;
  costValue: number;
  potentialResaleRevenue: number;
}

const inboundMovementTypes = new Set<InventoryMovementType>([
  "opening_balance",
  "purchase_receipt",
  "customer_return",
  "transfer_in",
]);

const outboundMovementTypes = new Set<InventoryMovementType>([
  "sale",
  "appointment_consumption",
  "supplier_return",
  "transfer_out",
  "write_off",
]);

function finite(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function nonNegative(value: number): number {
  return Math.max(0, finite(value));
}

function roundQuantity(value: number): number {
  return Math.round(finite(value) * 1000) / 1000;
}

export function inventoryStockStatus(item: InventoryItemSnapshot): InventoryStockStatus {
  const quantity = finite(item.quantity);
  const reorderPoint = nonNegative(item.reorderPoint);

  if (quantity <= 0) return "out-of-stock";
  if (quantity <= reorderPoint) return "low-stock";
  return "in-stock";
}

export function suggestedReorderQuantity(item: InventoryItemSnapshot): number {
  const quantity = finite(item.quantity);
  const targetQuantity = nonNegative(item.targetQuantity);
  return roundQuantity(Math.max(0, targetQuantity - quantity));
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
      return finite(left.quantity) - finite(right.quantity);
    });
}

export function summariseInventory(items: readonly InventoryItemSnapshot[]): InventorySummary {
  const activeItems = items.filter((item) => item.active !== false);

  return activeItems.reduce<InventorySummary>((summary, item) => {
    const quantity = finite(item.quantity);
    const unitCost = nonNegative(item.unitCost);
    const unitPrice = nonNegative(item.unitPrice ?? 0);
    const status = inventoryStockStatus(item);

    summary.activeItemCount += 1;
    summary.totalUnits = roundQuantity(summary.totalUnits + quantity);
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

export function inventoryBalances(
  movements: readonly InventoryMovementSnapshot[],
): InventoryLocationBalance[] {
  const balances = new Map<string, InventoryLocationBalance>();

  for (const movement of movements) {
    const key = `${movement.itemId}:${movement.locationId}`;
    const current = balances.get(key) ?? {
      itemId: movement.itemId,
      locationId: movement.locationId,
      quantity: 0,
    };
    current.quantity = roundQuantity(current.quantity + finite(movement.quantityDelta));
    balances.set(key, current);
  }

  return [...balances.values()].sort((left, right) =>
    `${left.itemId}:${left.locationId}`.localeCompare(`${right.itemId}:${right.locationId}`),
  );
}

export function inventoryBalanceFor(
  balances: readonly InventoryLocationBalance[],
  itemId: string,
  locationId?: string,
): number {
  return roundQuantity(balances
    .filter((balance) => balance.itemId === itemId)
    .filter((balance) => !locationId || balance.locationId === locationId)
    .reduce((total, balance) => total + balance.quantity, 0));
}

export function normaliseInventoryMovementDelta(
  movementType: InventoryMovementType,
  quantity: number,
): number {
  const value = finite(quantity);
  if (value === 0) return 0;
  if (inboundMovementTypes.has(movementType)) return Math.abs(value);
  if (outboundMovementTypes.has(movementType)) return -Math.abs(value);
  return roundQuantity(value);
}

export function isTransferMovement(movementType: InventoryMovementType): boolean {
  return movementType === "transfer_out" || movementType === "transfer_in";
}

export function reverseInventoryMovement(
  original: InventoryMovementSnapshot,
  reversalId: string,
  occurredAt: string,
): InventoryMovementSnapshot {
  if (original.movementType === "reversal") {
    throw new Error("A reversal movement cannot be reversed again.");
  }

  return {
    id: reversalId,
    itemId: original.itemId,
    locationId: original.locationId,
    movementType: "reversal",
    quantityDelta: roundQuantity(-original.quantityDelta),
    occurredAt,
    reversalOfId: original.id,
  };
}
