"use client";

import { useMemo, useState } from "react";
import {
  BadgePercent,
  Banknote,
  CalendarClock,
  CircleDollarSign,
  CreditCard,
  FileText,
  Package,
  Plus,
  ReceiptText,
  RotateCcw,
  Search,
  ShoppingBag,
  Sparkles,
  UserRound,
  Wrench,
} from "lucide-react";
import { useBdb } from "@/lib/store";
import { Badge, Button, Card, Dialog, PageHeader, StatCard } from "@/components/ui";
import styles from "./sales.module.css";

type SalesFilter = "all" | "paid" | "outstanding" | "refunded";

type PreviewSale = {
  reference: string;
  occurredAt: string;
  customer: string;
  channel: "Appointment" | "In-store" | "Manual";
  lineSummary: string;
  itemCount: number;
  gross: number;
  discount: number;
  total: number;
  amountPaid: number;
  paymentMethod: "Card" | "Cash" | "Mixed" | "Account";
  paymentStatus: "Paid" | "Part paid" | "Unpaid" | "Refunded";
  status: "Completed" | "Draft" | "Refunded";
};

const previewSales: PreviewSale[] = [
  {
    reference: "SALE-2026-0042",
    occurredAt: "27 Jul 2026 · 10:35",
    customer: "Maria Galea",
    channel: "Appointment",
    lineSummary: "Deep Cleansing Facial + 2 products",
    itemCount: 3,
    gross: 110.5,
    discount: 12,
    total: 98.5,
    amountPaid: 98.5,
    paymentMethod: "Card",
    paymentStatus: "Paid",
    status: "Completed",
  },
  {
    reference: "SALE-2026-0041",
    occurredAt: "27 Jul 2026 · 09:12",
    customer: "Walk-in customer",
    channel: "In-store",
    lineSummary: "2 retail products",
    itemCount: 2,
    gross: 43,
    discount: 0,
    total: 43,
    amountPaid: 43,
    paymentMethod: "Cash",
    paymentStatus: "Paid",
    status: "Completed",
  },
  {
    reference: "SALE-2026-0040",
    occurredAt: "26 Jul 2026 · 17:45",
    customer: "Claire Borg",
    channel: "Manual",
    lineSummary: "Hydrating Facial Treatment",
    itemCount: 1,
    gross: 82,
    discount: 0,
    total: 82,
    amountPaid: 40,
    paymentMethod: "Mixed",
    paymentStatus: "Part paid",
    status: "Completed",
  },
  {
    reference: "SALE-2026-0039",
    occurredAt: "26 Jul 2026 · 15:20",
    customer: "Josephine Vella",
    channel: "In-store",
    lineSummary: "1 retail product",
    itemCount: 1,
    gross: 24.5,
    discount: 0,
    total: 24.5,
    amountPaid: 0,
    paymentMethod: "Card",
    paymentStatus: "Refunded",
    status: "Refunded",
  },
  {
    reference: "SALE-2026-0038",
    occurredAt: "26 Jul 2026 · 13:10",
    customer: "Walk-in customer",
    channel: "Manual",
    lineSummary: "Consultation and Skin Review",
    itemCount: 1,
    gross: 0,
    discount: 0,
    total: 0,
    amountPaid: 0,
    paymentMethod: "Account",
    paymentStatus: "Unpaid",
    status: "Draft",
  },
];

function paymentTone(status: PreviewSale["paymentStatus"]): "green" | "gold" | "blue" | "neutral" {
  if (status === "Paid") return "green";
  if (status === "Part paid") return "gold";
  if (status === "Unpaid") return "blue";
  return "neutral";
}

function statusTone(status: PreviewSale["status"]): "green" | "gold" | "neutral" {
  if (status === "Completed") return "green";
  if (status === "Draft") return "gold";
  return "neutral";
}

export default function SalesPage() {
  const { state, role } = useBdb();
  const [formOpen, setFormOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<SalesFilter>("all");
  const supportMode = role === "platform-support";

  const currency = useMemo(
    () => new Intl.NumberFormat("en-GB", { style: "currency", currency: state.settings.currency }),
    [state.settings.currency],
  );

  const visibleSales = useMemo(() => {
    const term = query.trim().toLowerCase();
    return previewSales.filter((sale) => {
      const matchesQuery = !term || [
        sale.reference,
        sale.customer,
        sale.channel,
        sale.lineSummary,
        sale.paymentMethod,
        sale.paymentStatus,
        sale.status,
      ].join(" ").toLowerCase().includes(term);
      const matchesFilter = filter === "all"
        || (filter === "paid" && sale.paymentStatus === "Paid")
        || (filter === "outstanding" && ["Part paid", "Unpaid"].includes(sale.paymentStatus))
        || (filter === "refunded" && sale.paymentStatus === "Refunded");
      return matchesQuery && matchesFilter;
    });
  }, [filter, query]);

  const completedSales = previewSales.filter((sale) => sale.status === "Completed");
  const completedTotal = completedSales.reduce((total, sale) => total + sale.total, 0);
  const outstandingTotal = previewSales
    .filter((sale) => sale.status !== "Refunded")
    .reduce((total, sale) => total + Math.max(0, sale.total - sale.amountPaid), 0);
  const refundedTotal = previewSales
    .filter((sale) => sale.status === "Refunded")
    .reduce((total, sale) => total + sale.total, 0);
  const averageSale = completedSales.length ? completedTotal / completedSales.length : 0;

  return (
    <>
      <PageHeader
        eyebrow="Revenue operations"
        title="Sales"
        description="Review customer purchases that connect catalogue lines, stock movement, invoicing and payment status without duplicating Accounts."
        action={(
          <div className={styles.headerActions}>
            <Button variant="secondary" disabled title="Sales export will be connected after the sales schema is approved">
              <FileText size={17} /> Export sales
            </Button>
            <Button onClick={() => setFormOpen(true)}>
              <Plus size={17} /> Record sale
            </Button>
          </div>
        )}
      />

      <div className="review-callout">
        <Sparkles size={19} />
        <div>
          <strong>Visual migration preview</strong>
          <p>Rows below are representative design data only. No sale, customer link, stock movement, invoice, payment or balance has been created.</p>
        </div>
      </div>

      {supportMode ? (
        <div className={styles.supportNotice}>
          <ShoppingBag size={18} />
          <div><strong>Founder support · Read only</strong><span>Sales actions remain blocked during the audited support session.</span></div>
        </div>
      ) : null}

      <div className="stat-grid">
        <StatCard label="Completed sales" value={currency.format(completedTotal)} detail={`${completedSales.length} representative sales`} icon={<CircleDollarSign size={19} />} />
        <StatCard label="Average sale" value={currency.format(averageSale)} detail="Completed preview transactions" icon={<ReceiptText size={19} />} />
        <StatCard label="Outstanding" value={currency.format(outstandingTotal)} detail="Part-paid and unpaid preview value" icon={<CreditCard size={19} />} />
        <StatCard label="Refunded" value={currency.format(refundedTotal)} detail="Representative reversal value" icon={<RotateCcw size={19} />} />
      </div>

      <Card className={styles.salesCard}>
        <div className={styles.toolbar}>
          <label className={styles.searchField}>
            <Search size={17} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search sale, customer, item, payment or status…"
              aria-label="Search sales"
            />
          </label>
          <div className={styles.filters} aria-label="Sales filters">
            {(["all", "paid", "outstanding", "refunded"] as SalesFilter[]).map((item) => (
              <button
                key={item}
                type="button"
                className={filter === item ? styles.activeFilter : ""}
                onClick={() => setFilter(item)}
              >
                {item === "all" ? "All" : item === "paid" ? "Paid" : item === "outstanding" ? "Outstanding" : "Refunded"}
              </button>
            ))}
          </div>
          <Badge tone="neutral">{visibleSales.length} preview rows</Badge>
        </div>

        <div className="table-scroll">
          <table className={styles.salesTable}>
            <thead>
              <tr>
                <th>Sale</th>
                <th>Customer</th>
                <th>Channel</th>
                <th>Items</th>
                <th>Gross</th>
                <th>Discount</th>
                <th>Total</th>
                <th>Payment</th>
                <th>Status</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {visibleSales.map((sale) => (
                <tr key={sale.reference}>
                  <td>
                    <div className={styles.saleIdentity}>
                      <span><ShoppingBag size={17} /></span>
                      <div><strong>{sale.reference}</strong><small>{sale.occurredAt}</small></div>
                    </div>
                  </td>
                  <td><div className={styles.customerCell}><UserRound size={15} /><span>{sale.customer}</span></div></td>
                  <td><Badge tone={sale.channel === "Appointment" ? "gold" : sale.channel === "In-store" ? "green" : "blue"}>{sale.channel}</Badge></td>
                  <td><div className={styles.itemsCell}><strong>{sale.lineSummary}</strong><small>{sale.itemCount} line item{sale.itemCount === 1 ? "" : "s"}</small></div></td>
                  <td>{currency.format(sale.gross)}</td>
                  <td>{sale.discount ? `−${currency.format(sale.discount)}` : <span className="muted">—</span>}</td>
                  <td><strong>{currency.format(sale.total)}</strong></td>
                  <td>
                    <div className={styles.paymentCell}>
                      <Badge tone={paymentTone(sale.paymentStatus)}>{sale.paymentStatus}</Badge>
                      <small>{sale.paymentMethod}</small>
                    </div>
                  </td>
                  <td><Badge tone={statusTone(sale.status)}>{sale.status}</Badge></td>
                  <td><Button type="button" variant="quiet" disabled aria-label={`Open ${sale.reference}`}>Open</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {visibleSales.length === 0 ? (
          <div className={styles.emptyState}>
            <ShoppingBag size={23} />
            <h3>No preview sales match</h3>
            <p>Change the search term or sales filter.</p>
          </div>
        ) : null}
      </Card>

      <div className={styles.lowerGrid}>
        <Card className={styles.guidanceCard}>
          <div className={styles.cardIcon}><Package size={20} /></div>
          <p className="eyebrow">Inventory boundary</p>
          <h2>Post stock movement only when a sale completes</h2>
          <p className="muted">Draft sales must not reduce stock. A completed product line will eventually create an auditable Inventory movement with the sale reference as its source.</p>
        </Card>
        <Card className={styles.guidanceCard}>
          <div className={styles.cardIcon}><ReceiptText size={20} /></div>
          <p className="eyebrow">Accounts boundary</p>
          <h2>One sale, one financial history</h2>
          <p className="muted">Sales records describe what was purchased. Invoices, payments, outstanding balances and settlement remain authoritative in Accounts and Banking.</p>
        </Card>
      </div>

      <Dialog
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title="Record sale"
        description="Visual preview of the connected BDB OS sales workflow. Fields do not accept or save data yet."
        className={styles.saleDialog}
      >
        <div className={styles.formBody}>
          <div className={styles.contextGrid}>
            <label>Customer<select disabled defaultValue="walk-in"><option value="walk-in">Walk-in customer</option><option value="existing">Choose existing customer</option></select></label>
            <label>Sale date and time<input disabled type="datetime-local" /></label>
            <label>Sales channel<select disabled defaultValue="in-store"><option value="in-store">In-store</option><option value="appointment">Appointment</option><option value="manual">Manual</option></select></label>
            <label>Staff member<select disabled defaultValue="owner"><option value="owner">Vanita Workspace Owner</option></select></label>
          </div>

          <div className={styles.saleBuilder}>
            <section className={styles.linesPanel}>
              <div className={styles.panelHeader}>
                <div><p className="eyebrow">Sale lines</p><h3>Products and services</h3></div>
                <div className={styles.lineActions}>
                  <Button type="button" variant="secondary" disabled><Package size={16} /> Add product</Button>
                  <Button type="button" variant="secondary" disabled><Wrench size={16} /> Add service</Button>
                </div>
              </div>
              <div className={styles.previewLine}>
                <span className={styles.lineIcon}><Package size={18} /></span>
                <div className={styles.lineDescription}><strong>Example catalogue line</strong><small>Product or service selected from the shared catalogue</small></div>
                <label>Qty<input disabled value="1" readOnly /></label>
                <label>Unit price<input disabled value="0.00" readOnly /></label>
                <label>Discount<input disabled value="0.00" readOnly /></label>
                <strong className={styles.lineTotal}>{currency.format(0)}</strong>
              </div>
              <div className={styles.lineHint}><BadgePercent size={16} /><span>Line discounts must be preserved on the sale and must not overwrite catalogue pricing.</span></div>
            </section>

            <aside className={styles.summaryPanel}>
              <p className="eyebrow">Sale summary</p>
              <div className={styles.summaryRows}>
                <div><span>Subtotal</span><strong>{currency.format(0)}</strong></div>
                <div><span>Discount</span><strong>−{currency.format(0)}</strong></div>
                <div><span>VAT</span><strong>{currency.format(0)}</strong></div>
                <div className={styles.totalRow}><span>Total</span><strong>{currency.format(0)}</strong></div>
              </div>
              <label>Payment method<select disabled defaultValue="card"><option value="card">Card</option><option value="cash">Cash</option><option value="mixed">Mixed</option><option value="account">On account</option></select></label>
              <label>Amount received<input disabled type="number" placeholder="0.00" /></label>
              <label className={styles.invoiceOption}><input disabled type="checkbox" /><span>Create or link customer invoice</span></label>
            </aside>
          </div>

          <div className={styles.boundaryNote}>
            <Banknote size={18} />
            <div><strong>Connected transaction, separate ledgers</strong><span>Completing a sale will eventually coordinate Inventory and Accounts through trusted commands. The Sales screen will not write stock quantities or payment balances directly.</span></div>
          </div>
        </div>
        <div className="dialog-actions">
          <Button type="button" variant="quiet" onClick={() => setFormOpen(false)}>Close preview</Button>
          <Button type="button" variant="secondary" disabled>Save draft</Button>
          <Button type="button" disabled>Complete sale</Button>
        </div>
      </Dialog>
    </>
  );
}
