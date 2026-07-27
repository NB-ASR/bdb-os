"use client";

import { useMemo, useState } from "react";
import {
  Archive,
  BadgePercent,
  Building2,
  FileText,
  Mail,
  Package,
  Phone,
  Plus,
  Search,
  Sparkles,
  Truck,
  WalletCards,
} from "lucide-react";
import { useBdb } from "@/lib/store";
import { Badge, Button, Card, Dialog, PageHeader, StatCard } from "@/components/ui";
import styles from "./suppliers.module.css";

type SupplierFilter = "all" | "products" | "services" | "archived";

type PreviewSupplier = {
  name: string;
  code: string;
  supplierType: "Product supplier" | "Service provider" | "General expense";
  contactName: string;
  email: string;
  phone: string;
  categories: string[];
  paymentTerms: string;
  defaultDiscount: number;
  linkedProducts: number;
  status: "Active" | "Archived";
};

const previewSuppliers: PreviewSupplier[] = [
  {
    name: "Collis Williams",
    code: "SUP-CW",
    supplierType: "Product supplier",
    contactName: "Amelia Borg",
    email: "orders@colliswilliams.example",
    phone: "+356 2123 4100",
    categories: ["Skincare", "Retail"],
    paymentTerms: "30 days",
    defaultDiscount: 10,
    linkedProducts: 6,
    status: "Active",
  },
  {
    name: "Makiba Essence",
    code: "SUP-MAK",
    supplierType: "Product supplier",
    contactName: "Daniel Mifsud",
    email: "trade@makiba.example",
    phone: "+356 2144 8090",
    categories: ["Body care", "Retail"],
    paymentTerms: "14 days",
    defaultDiscount: 5,
    linkedProducts: 3,
    status: "Active",
  },
  {
    name: "Salon Supply Co.",
    code: "SUP-SSC",
    supplierType: "Product supplier",
    contactName: "Trade desk",
    email: "accounts@salonsupply.example",
    phone: "+356 2138 2210",
    categories: ["Consumables", "Business supplies"],
    paymentTerms: "14 days",
    defaultDiscount: 12.5,
    linkedProducts: 2,
    status: "Active",
  },
  {
    name: "Local Laundry & Linen",
    code: "SUP-LINEN",
    supplierType: "Service provider",
    contactName: "Operations desk",
    email: "service@locallinen.example",
    phone: "+356 2155 6600",
    categories: ["Linen service", "Operations"],
    paymentTerms: "Due on receipt",
    defaultDiscount: 0,
    linkedProducts: 0,
    status: "Archived",
  },
];

export default function SuppliersPage() {
  const { state, role } = useBdb();
  const [formOpen, setFormOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<SupplierFilter>("all");
  const supportMode = role === "platform-support";

  const visibleSuppliers = useMemo(() => {
    const term = query.trim().toLowerCase();
    return previewSuppliers.filter((supplier) => {
      const matchesQuery = !term || [
        supplier.name,
        supplier.code,
        supplier.supplierType,
        supplier.contactName,
        supplier.email,
        supplier.phone,
        supplier.categories.join(" "),
        supplier.paymentTerms,
      ].join(" ").toLowerCase().includes(term);
      const matchesFilter = filter === "all"
        || (filter === "products" && supplier.supplierType === "Product supplier" && supplier.status === "Active")
        || (filter === "services" && supplier.supplierType === "Service provider" && supplier.status === "Active")
        || (filter === "archived" && supplier.status === "Archived");
      return matchesQuery && matchesFilter;
    });
  }, [filter, query]);

  const activeSuppliers = previewSuppliers.filter((supplier) => supplier.status === "Active");
  const averageDiscount = activeSuppliers.reduce((total, supplier) => total + supplier.defaultDiscount, 0) / activeSuppliers.length;
  const linkedProducts = activeSuppliers.reduce((total, supplier) => total + supplier.linkedProducts, 0);

  return (
    <>
      <PageHeader
        eyebrow="Purchasing directory"
        title="Suppliers"
        description="Maintain the supplier directory that products, purchasing documents, stock receipts and payment terms will reference."
        action={(
          <div className={styles.headerActions}>
            <Button variant="secondary" disabled title="Supplier import will be connected after the supplier schema is approved">
              <FileText size={17} /> Import suppliers
            </Button>
            <Button onClick={() => setFormOpen(true)}>
              <Plus size={17} /> Add supplier
            </Button>
          </div>
        )}
      />

      <div className="review-callout">
        <Sparkles size={19} />
        <div>
          <strong>Visual migration preview</strong>
          <p>Rows below are representative design data only. No supplier, contact, payment term, discount or product relationship has been created.</p>
        </div>
      </div>

      {supportMode ? (
        <div className={styles.supportNotice}>
          <Truck size={18} />
          <div><strong>Founder support · Read only</strong><span>Supplier-directory changes remain blocked during the audited support session.</span></div>
        </div>
      ) : null}

      <div className="stat-grid">
        <StatCard label="Preview suppliers" value={String(previewSuppliers.length)} detail="Representative directory rows" icon={<Building2 size={19} />} />
        <StatCard label="Linked products" value={String(linkedProducts)} detail="Preview catalogue relationships" icon={<Package size={19} />} />
        <StatCard label="Average discount" value={`${averageDiscount.toFixed(1)}%`} detail="Default active-supplier terms" icon={<BadgePercent size={19} />} />
        <StatCard label="Terms recorded" value={String(activeSuppliers.length)} detail="Active suppliers with payment terms" icon={<WalletCards size={19} />} />
      </div>

      <Card className={styles.suppliersCard}>
        <div className={styles.toolbar}>
          <label className={styles.searchField}>
            <Search size={17} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search supplier, code, contact, category or terms…"
              aria-label="Search suppliers"
            />
          </label>
          <div className={styles.filters} aria-label="Supplier filters">
            {(["all", "products", "services", "archived"] as SupplierFilter[]).map((item) => (
              <button
                key={item}
                type="button"
                className={filter === item ? styles.activeFilter : ""}
                onClick={() => setFilter(item)}
              >
                {item === "all" ? "All" : item === "products" ? "Product" : item === "services" ? "Services" : "Archived"}
              </button>
            ))}
          </div>
          <Badge tone="neutral">{visibleSuppliers.length} preview rows</Badge>
        </div>

        <div className="table-scroll">
          <table className={styles.supplierTable}>
            <thead>
              <tr>
                <th>Supplier</th>
                <th>Code</th>
                <th>Type</th>
                <th>Contact</th>
                <th>Supplies</th>
                <th>Payment terms</th>
                <th>Default discount</th>
                <th>Linked products</th>
                <th>Status</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {visibleSuppliers.map((supplier) => (
                <tr key={supplier.code}>
                  <td>
                    <div className={styles.supplierIdentity}>
                      <span><Truck size={17} /></span>
                      <div><strong>{supplier.name}</strong><small>Reusable supplier record</small></div>
                    </div>
                  </td>
                  <td><code>{supplier.code}</code></td>
                  <td><Badge tone={supplier.supplierType === "Product supplier" ? "gold" : "blue"}>{supplier.supplierType}</Badge></td>
                  <td>
                    <div className={styles.contactCell}>
                      <strong>{supplier.contactName}</strong>
                      <span><Mail size={13} /> {supplier.email}</span>
                      <small><Phone size={13} /> {supplier.phone}</small>
                    </div>
                  </td>
                  <td><div className={styles.categoriesCell}>{supplier.categories.map((category) => <span className={styles.categoryTag} key={category}>{category}</span>)}</div></td>
                  <td>{supplier.paymentTerms}</td>
                  <td><div className={styles.discountCell}><BadgePercent size={15} /><span>{supplier.defaultDiscount}%</span></div></td>
                  <td><div className={styles.linkedCell}><Package size={15} /><span>{supplier.linkedProducts}</span></div></td>
                  <td><Badge tone={supplier.status === "Active" ? "green" : "neutral"}>{supplier.status}</Badge></td>
                  <td><Button type="button" variant="quiet" disabled aria-label={`Edit ${supplier.name}`}>Edit</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {visibleSuppliers.length === 0 ? (
          <div className={styles.emptyState}>
            <Truck size={23} />
            <h3>No preview suppliers match</h3>
            <p>Change the search term or supplier filter.</p>
          </div>
        ) : null}
      </Card>

      <div className={styles.lowerGrid}>
        <Card className={styles.guidanceCard}>
          <div className={styles.cardIcon}><FileText size={20} /></div>
          <p className="eyebrow">Document connection</p>
          <h2>One supplier across purchasing workflows</h2>
          <p className="muted">Supplier invoices and credit notes should link to this record before their product lines create stock receipts or their totals enter Accounts.</p>
        </Card>
        <Card className={styles.guidanceCard}>
          <div className={styles.cardIcon}><BadgePercent size={20} /></div>
          <p className="eyebrow">Pricing boundary</p>
          <h2>Default terms do not overwrite history</h2>
          <p className="muted">The supplier discount is a starting rule. Each document must preserve its actual line discounts, paid costs and payment terms for historical accuracy.</p>
        </Card>
      </div>

      <Dialog
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title="Add supplier"
        description="Visual preview of the reusable BDB OS supplier definition. Fields do not accept or save data yet."
        className={styles.supplierDialog}
      >
        <div className={styles.formBody}>
          <div className={styles.formGrid}>
            <label className={styles.wide}>Supplier name<input disabled placeholder="e.g. Collis Williams" /></label>
            <label>Supplier code<input disabled placeholder="e.g. SUP-CW" /></label>
            <label>Supplier type<select disabled defaultValue="product"><option value="product">Product supplier</option><option value="service">Service provider</option><option value="expense">General expense</option></select></label>
            <label>Contact name<input disabled placeholder="Primary contact" /></label>
            <label>Email<input disabled type="email" placeholder="orders@supplier.com" /></label>
            <label>Phone<input disabled type="tel" placeholder="+356 …" /></label>
            <label>VAT / registration number<input disabled placeholder="Supplier tax identifier" /></label>
            <label>Payment terms<select disabled defaultValue="30"><option value="receipt">Due on receipt</option><option value="7">7 days</option><option value="14">14 days</option><option value="30">30 days</option></select></label>
            <label>Default discount (%)<input disabled type="number" placeholder="0.00" /></label>
            <label>Document currency<select disabled defaultValue={state.settings.currency}><option value={state.settings.currency}>{state.settings.currency}</option></select></label>
            <label>Supplied categories<input disabled placeholder="Skincare, consumables, equipment…" /></label>
            <label>Status<select disabled defaultValue="active"><option value="active">Active</option><option value="archived">Archived</option></select></label>
            <label className={styles.wide}>Address<div className={styles.addressGrid}><input disabled placeholder="Street and locality" /><input disabled placeholder="Postcode" /><input disabled placeholder="Country" /></div></label>
            <label className={styles.wide}>Notes<textarea disabled rows={3} placeholder="Ordering instructions, account references or delivery notes" /></label>
          </div>
          <div className={styles.boundaryNote}>
            <WalletCards size={18} />
            <div><strong>Supplier terms, not payment execution</strong><span>This directory stores purchasing identity and default terms. Bank details, payment approval and settlement remain controlled by Accounts and Banking.</span></div>
          </div>
        </div>
        <div className="dialog-actions">
          <Button type="button" variant="quiet" onClick={() => setFormOpen(false)}>Close preview</Button>
          <Button type="button" disabled>Save supplier</Button>
        </div>
      </Dialog>
    </>
  );
}