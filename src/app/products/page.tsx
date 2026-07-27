"use client";

import { useMemo, useState } from "react";
import {
  Archive,
  Barcode,
  Boxes,
  CircleDollarSign,
  Package,
  PackagePlus,
  Search,
  Sparkles,
  Tags,
  Truck,
} from "lucide-react";
import { useBdb } from "@/lib/store";
import { Badge, Button, Card, Dialog, PageHeader, StatCard } from "@/components/ui";
import styles from "./products.module.css";

type ProductFilter = "all" | "resale" | "supplies" | "archived";

type PreviewProduct = {
  name: string;
  sku: string;
  purpose: "Resale stock" | "Business supply";
  brand: string;
  supplier: string;
  category: string;
  barcode: string;
  unitCost: number;
  sellingPrice: number | null;
  reorderAt: number;
  status: "Active" | "Archived";
};

const previewProducts: PreviewProduct[] = [
  {
    name: "Hydra Medic Serum 60ml",
    sku: "RPHMS",
    purpose: "Resale stock",
    brand: "Repêchage",
    supplier: "Collis Williams",
    category: "Skincare",
    barcode: "539000000001",
    unitCost: 18.5,
    sellingPrice: 39,
    reorderAt: 4,
    status: "Active",
  },
  {
    name: "Makiba Essence Oil 30ml",
    sku: "MKO-30",
    purpose: "Resale stock",
    brand: "Makiba",
    supplier: "Makiba Essence",
    category: "Body care",
    barcode: "539000000002",
    unitCost: 12,
    sellingPrice: 28,
    reorderAt: 6,
    status: "Active",
  },
  {
    name: "Disposable Treatment Towels",
    sku: "SUP-TOWEL",
    purpose: "Business supply",
    brand: "—",
    supplier: "Salon Supply Co.",
    category: "Consumables",
    barcode: "—",
    unitCost: 8.4,
    sellingPrice: null,
    reorderAt: 10,
    status: "Active",
  },
  {
    name: "Seasonal Gift Set",
    sku: "GIFT-01",
    purpose: "Resale stock",
    brand: "Vanita",
    supplier: "Local assembly",
    category: "Gift sets",
    barcode: "—",
    unitCost: 22,
    sellingPrice: 49,
    reorderAt: 2,
    status: "Archived",
  },
];

export default function ProductsPage() {
  const { state, role } = useBdb();
  const [formOpen, setFormOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ProductFilter>("all");
  const supportMode = role === "platform-support";

  const currency = useMemo(
    () => new Intl.NumberFormat("en-GB", { style: "currency", currency: state.settings.currency }),
    [state.settings.currency],
  );

  const visibleProducts = useMemo(() => {
    const term = query.trim().toLowerCase();
    return previewProducts.filter((product) => {
      const matchesQuery = !term || [
        product.name,
        product.sku,
        product.purpose,
        product.brand,
        product.supplier,
        product.category,
        product.barcode,
      ].join(" ").toLowerCase().includes(term);
      const matchesFilter = filter === "all"
        || (filter === "resale" && product.purpose === "Resale stock" && product.status === "Active")
        || (filter === "supplies" && product.purpose === "Business supply" && product.status === "Active")
        || (filter === "archived" && product.status === "Archived");
      return matchesQuery && matchesFilter;
    });
  }, [filter, query]);

  return (
    <>
      <PageHeader
        eyebrow="Product catalogue"
        title="Products"
        description="Define the reusable catalogue that inventory, supplier documents, sales and invoice lines will reference."
        action={(
          <div className={styles.headerActions}>
            <Button variant="secondary" disabled title="Bulk product import will be connected after the catalogue schema is approved">
              <Boxes size={17} /> Import catalogue
            </Button>
            <Button onClick={() => setFormOpen(true)}>
              <PackagePlus size={17} /> Add product
            </Button>
          </div>
        )}
      />

      <div className="review-callout">
        <Sparkles size={19} />
        <div>
          <strong>Visual migration preview</strong>
          <p>Rows below are representative preview data only. No product, price, supplier or barcode record has been created.</p>
        </div>
      </div>

      {supportMode ? (
        <div className={styles.supportNotice}>
          <Package size={18} />
          <div><strong>Founder support · Read only</strong><span>Product catalogue changes remain blocked during the audited support session.</span></div>
        </div>
      ) : null}

      <div className="stat-grid">
        <StatCard label="Preview products" value={String(previewProducts.length)} detail="Representative layout records" icon={<Package size={19} />} />
        <StatCard label="Resale items" value={String(previewProducts.filter((item) => item.purpose === "Resale stock").length)} detail="Available for customer sales" icon={<Tags size={19} />} />
        <StatCard label="Business supplies" value={String(previewProducts.filter((item) => item.purpose === "Business supply").length)} detail="Tracked but not sold" icon={<Boxes size={19} />} />
        <StatCard label="Suppliers shown" value={String(new Set(previewProducts.map((item) => item.supplier)).size)} detail="Supplier directory connection" icon={<Truck size={19} />} />
      </div>

      <Card className={styles.catalogueCard}>
        <div className={styles.toolbar}>
          <label className={styles.searchField}>
            <Search size={17} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search name, SKU, brand, supplier or barcode…"
              aria-label="Search products"
            />
          </label>
          <div className={styles.filters} aria-label="Product filters">
            {(["all", "resale", "supplies", "archived"] as ProductFilter[]).map((item) => (
              <button
                key={item}
                type="button"
                className={filter === item ? styles.activeFilter : ""}
                onClick={() => setFilter(item)}
              >
                {item === "all" ? "All" : item === "resale" ? "Resale" : item === "supplies" ? "Supplies" : "Archived"}
              </button>
            ))}
          </div>
          <Badge tone="neutral">{visibleProducts.length} preview rows</Badge>
        </div>

        <div className="table-scroll">
          <table className={styles.productTable}>
            <thead>
              <tr>
                <th>Product</th>
                <th>SKU</th>
                <th>Purpose</th>
                <th>Brand</th>
                <th>Supplier</th>
                <th>Category</th>
                <th>Barcode</th>
                <th>Unit cost</th>
                <th>Selling price</th>
                <th>Reorder at</th>
                <th>Status</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {visibleProducts.map((product) => (
                <tr key={product.sku}>
                  <td><div className={styles.productIdentity}><span><Package size={17} /></span><strong>{product.name}</strong></div></td>
                  <td><code>{product.sku}</code></td>
                  <td><Badge tone={product.purpose === "Resale stock" ? "gold" : "blue"}>{product.purpose}</Badge></td>
                  <td>{product.brand}</td>
                  <td>{product.supplier}</td>
                  <td>{product.category}</td>
                  <td className={styles.barcodeCell}><Barcode size={15} /><span>{product.barcode}</span></td>
                  <td>{currency.format(product.unitCost)}</td>
                  <td>{product.sellingPrice === null ? <span className="muted">Not for sale</span> : currency.format(product.sellingPrice)}</td>
                  <td>{product.reorderAt}</td>
                  <td><Badge tone={product.status === "Active" ? "green" : "neutral"}>{product.status}</Badge></td>
                  <td><Button type="button" variant="quiet" disabled aria-label={`Edit ${product.name}`}>Edit</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {visibleProducts.length === 0 ? (
          <div className={styles.emptyState}>
            <Package size={23} />
            <h3>No preview products match</h3>
            <p>Change the search term or product filter.</p>
          </div>
        ) : null}
      </Card>

      <div className={styles.lowerGrid}>
        <Card className={styles.guidanceCard}>
          <div className={styles.cardIcon}><CircleDollarSign size={20} /></div>
          <p className="eyebrow">Pricing boundary</p>
          <h2>Catalogue values, not stock totals</h2>
          <p className="muted">Unit cost, selling price and VAT belong to the product definition. Quantity and stock valuation belong to Inventory movements.</p>
        </Card>
        <Card className={styles.guidanceCard}>
          <div className={styles.cardIcon}><Archive size={20} /></div>
          <p className="eyebrow">Record lifecycle</p>
          <h2>Archive instead of delete</h2>
          <p className="muted">Products referenced by supplier documents, sales or invoices should be archived so historical records remain intact.</p>
        </Card>
      </div>

      <Dialog
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title="Add product"
        description="Visual preview of the reusable BDB OS product definition. Fields do not accept or save data yet."
        className={styles.productDialog}
      >
        <div className={styles.formBody}>
          <div className={styles.formGrid}>
            <label className={styles.wide}>Product name<input disabled placeholder="e.g. Hydra Medic Serum 60ml" /></label>
            <label>SKU / stock code<input disabled placeholder="e.g. RPHMS" /></label>
            <label>Barcode<div className={styles.barcodeInput}><input disabled placeholder="Type or scan barcode" /><Button type="button" variant="secondary" disabled><Barcode size={16} /> Scan</Button></div></label>
            <label>Brand<input disabled placeholder="Brand name" /></label>
            <label>Supplier<select disabled defaultValue=""><option value="">Choose supplier</option></select></label>
            <label>Category<select disabled defaultValue="skincare"><option value="skincare">Skincare</option><option value="body">Body care</option><option value="consumables">Consumables</option></select></label>
            <label>Item purpose<select disabled defaultValue="resale"><option value="resale">Resale stock</option><option value="supply">Business supply</option></select></label>
            <label>Unit cost ({state.settings.currency})<input disabled type="number" placeholder="0.00" /></label>
            <label>Selling price ({state.settings.currency})<input disabled type="number" placeholder="0.00" /></label>
            <label>VAT rate (%)<input disabled type="number" placeholder="18" /></label>
            <label>Reorder level<input disabled type="number" placeholder="5" /></label>
            <label className={styles.wide}>Notes<textarea disabled rows={3} placeholder="Optional product notes" /></label>
          </div>
          <div className={styles.openingStockNote}>
            <Boxes size={18} />
            <div><strong>Opening stock is a separate movement</strong><span>The product will be defined first. Opening quantity will then be recorded through Inventory so the movement history stays auditable.</span></div>
          </div>
        </div>
        <div className="dialog-actions">
          <Button type="button" variant="quiet" onClick={() => setFormOpen(false)}>Close preview</Button>
          <Button type="button" disabled>Save product</Button>
        </div>
      </Dialog>
    </>
  );
}
