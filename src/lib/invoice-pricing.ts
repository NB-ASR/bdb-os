export type InvoiceLinePricing = {
  netAmount: number;
  vatAmount: number;
  totalAmount: number;
};

function moneyRound(value: number) {
  return Math.round((value + Number.EPSILON) * 10000) / 10000;
}

export function calculateVatExclusiveLine(
  quantity: number,
  unitPrice: number,
  discountAmount: number,
  vatRate: number,
): InvoiceLinePricing {
  const grossBeforeDiscount = Math.max(0, quantity) * Math.max(0, unitPrice);
  const netAmount = moneyRound(Math.max(grossBeforeDiscount - Math.max(0, discountAmount), 0));
  const vatAmount = moneyRound(netAmount * Math.max(0, vatRate) / 100);
  return {
    netAmount,
    vatAmount,
    totalAmount: moneyRound(netAmount + vatAmount),
  };
}

export function calculateInvoiceTotals(
  lines: Array<{ quantity: number; unitPrice: number; discountAmount: number; vatRate: number }>,
): InvoiceLinePricing {
  return lines.reduce<InvoiceLinePricing>((totals, line) => {
    const priced = calculateVatExclusiveLine(line.quantity, line.unitPrice, line.discountAmount, line.vatRate);
    return {
      netAmount: moneyRound(totals.netAmount + priced.netAmount),
      vatAmount: moneyRound(totals.vatAmount + priced.vatAmount),
      totalAmount: moneyRound(totals.totalAmount + priced.totalAmount),
    };
  }, { netAmount: 0, vatAmount: 0, totalAmount: 0 });
}
