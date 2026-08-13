export type InventoryMovementType =
  | "opening_balance"
  | "purchase_receipt"
  | "sale"
  | "appointment_consumption"
  | "internal_consumption"
  | "customer_return"
  | "supplier_return"
  | "transfer_out"
  | "transfer_in"
  | "manual_adjustment"
  | "stocktake_correction"
  | "write_off"
  | "reversal";

export type InventoryStockStatus = "in-stock" | "low-stock" | "out-of-stock";

export type InventoryProductSnapshot = {
  id: string;
  name: string;
  sku: string;
  purpose: "resale" | "supply";
  quantity: number;
  reorderLevel: number;
  unitCost: number;
  sellingPrice?: number | null;
  status?: "active" | "archived";
};

export type InventoryMovementSnapshot = {
  id: string;
  productId: string;
  locationId: string;
  movementType: InventoryMovementType;
  quantityDelta: number;
  occurredAt: string;
  reversalOfId?: string | null;
  transferGroupId?: string | null;
};

export type InventoryLocationBalance = {
  productId: string;
  locationId: string;
  quantity: number;
};

export type InventorySummary = {
  activeProductCount: number;
  totalUnits: number;
  lowStockProductCount: number;
  outOfStockProductCount: number;
  catalogueCostValue: number;
  potentialResaleValue: number;
};

const inboundTypes = new Set<InventoryMovementType>([
  "opening_balance",
  "purchase_receipt",
  "customer_return",
  "transfer_in",
]);

const outboundTypes = new Set<InventoryMovementType>([
  "sale",
  "appointment_consumption",
  "internal_consumption",
  "supplier_return",
  "transfer_out",
  "write_off",
]);

function finite(value: number) {
  return Number.isFinite(value) ? value : 0;
}

export function roundInventoryQuantity(value: number) {
  const safeValue = finite(value);
  return Math.sign(safeValue) * Math.round(Math.abs(safeValue) * 1000) / 1000;
}

export function normaliseInventoryMovementDelta(
  movementType: InventoryMovementType,
  quantity: number,
) {
  const value = finite(quantity);
  if (value === 0) return 0;
  if (inboundTypes.has(movementType)) return roundInventoryQuantity(Math.abs(value));
  if (outboundTypes.has(movementType)) return roundInventoryQuantity(-Math.abs(value));
  return roundInventoryQuantity(value);
}

export function inventoryStockStatus(product: InventoryProductSnapshot): InventoryStockStatus {
  const quantity = finite(product.quantity);
  const reorderLevel = Math.max(0, finite(product.reorderLevel));
  if (quantity <= 0) return "out-of-stock";
  if (quantity <= reorderLevel) return "low-stock";
  return "in-stock";
}

export function suggestedReorderQuantity(product: InventoryProductSnapshot) {
  const quantity = finite(product.quantity);
  const reorderLevel = Math.max(0, finite(product.reorderLevel));
  return roundInventoryQuantity(Math.max(0, reorderLevel - quantity));
}

export function inventoryBalances(
  movements: readonly InventoryMovementSnapshot[],
): InventoryLocationBalance[] {
  const balances = new Map<string, InventoryLocationBalance>();
  for (const movement of movements) {
    const key = `${movement.productId}:${movement.locationId}`;
    const current = balances.get(key) ?? {
      productId: movement.productId,
      locationId: movement.locationId,
      quantity: 0,
    };
    current.quantity = roundInventoryQuantity(current.quantity + finite(movement.quantityDelta));
    balances.set(key, current);
  }
  return [...balances.values()];
}

export function inventoryBalanceFor(
  balances: readonly InventoryLocationBalance[],
  productId: string,
  locationId?: string,
) {
  return roundInventoryQuantity(
    balances
      .filter((balance) => balance.productId === productId)
      .filter((balance) => !locationId || balance.locationId === locationId)
      .reduce((total, balance) => total + balance.quantity, 0),
  );
}

export function summariseInventory(products: readonly InventoryProductSnapshot[]): InventorySummary {
  return products
    .filter((product) => product.status !== "archived")
    .reduce<InventorySummary>((summary, product) => {
      const quantity = finite(product.quantity);
      const unitCost = Math.max(0, finite(product.unitCost));
      const sellingPrice = Math.max(0, finite(product.sellingPrice ?? 0));
      const stockStatus = inventoryStockStatus(product);
      summary.activeProductCount += 1;
      summary.totalUnits = roundInventoryQuantity(summary.totalUnits + quantity);
      summary.catalogueCostValue += quantity * unitCost;
      if (product.purpose === "resale") summary.potentialResaleValue += quantity * sellingPrice;
      if (stockStatus === "low-stock") summary.lowStockProductCount += 1;
      if (stockStatus === "out-of-stock") summary.outOfStockProductCount += 1;
      return summary;
    }, {
      activeProductCount: 0,
      totalUnits: 0,
      lowStockProductCount: 0,
      outOfStockProductCount: 0,
      catalogueCostValue: 0,
      potentialResaleValue: 0,
    });
}

export function canReverseInventoryMovement(
  movement: {
    id: string;
    movementType: InventoryMovementType;
    reversalOfId?: string | null;
    transferGroupId?: string | null;
    supplierDocumentId?: string | null;
  },
  movements: readonly { reversalOfId?: string | null }[],
) {
  if (movement.movementType === "reversal") return false;
  if (movement.transferGroupId) return false;
  if (movement.supplierDocumentId) return false;
  return !movements.some((candidate) => candidate.reversalOfId === movement.id);
}
