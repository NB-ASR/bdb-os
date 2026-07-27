"use client";

import { useMemo, useState } from "react";
import {
  AlertTriangle,
  Boxes,
  CircleDollarSign,
  ClipboardList,
  FileSearch,
  PackageCheck,
  PackageMinus,
  ScanLine,
  Search,
  Sparkles,
  UploadCloud,
} from "lucide-react";
import { useBdb } from "@/lib/store";
import { Badge, Button, Card, Dialog, EmptyState, PageHeader, StatCard } from "@/components/ui";
import styles from "./inventory.module.css";

type StockFilter = "all" | "low" | "out";

const importSteps = ["Upload", "Review", "Complete"];

export default function InventoryPage() {
  const { state, role } = useBdb();
  const [importOpen, setImportOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<StockFilter>("all");

  const zeroValue = useMemo(
    () => new Intl.NumberFormat("en-GB", { style: "currency", currency: state.settings.currency }).format(0),
    [state.settings.currency],
  );
  const supportMode = role === "platform-support";

  return (
    <>
      <PageHeader
        eyebrow="Stock control"
        title="Inventory"
        description="Monitor stock on hand, restock levels and supplier-document movements from one workspace module."
        action={(
          <div className={styles.headerActions}>
            <Button variant="secondary" disabled title="Product creation will be connected after the visual layout is approved">
              <Boxes size={17} /> Add item
            </Button>
            <Button onClick={() => setImportOpen(true)}>
              <ScanLine size={17} /> Import supplier document
            </Button>
          </div>
        )}
      />

      <div className="review-callout">
        <Sparkles size={19} />
        <div>
          <strong>Visual migration preview</strong>
          <p>
            This is the first Vanita workflow translated into the BDB OS design language. No products, documents or stock movements can be created from this screen yet.
          </p>
        </div>
      </div>

      {supportMode ? (
        <div className={styles.supportNotice}>
          <FileSearch size={18} />
          <div><strong>Founder support · Read only</strong><span>Inventory remains non-editable during the audited support session.</span></div>
        </div>
      ) : null}

      <div className="stat-grid">
        <StatCard label="Items tracked" value="0" detail="No inventory records connected" icon={<Boxes size={19} />} />
        <StatCard label="Low stock" value="0" detail="At or below reorder level" icon={<AlertTriangle size={19} />} />
        <StatCard label="Out of stock" value="0" detail="Items requiring attention" icon={<PackageMinus size={19} />} />
        <StatCard label="Stock value" value={zeroValue} detail="Cost valuation will follow" icon={<CircleDollarSign size={19} />} />
      </div>

      <Card className={styles.inventoryCard}>
        <div className={styles.toolbar}>
          <label className={styles.searchField}>
            <Search size={17} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search product, SKU, category or supplier…"
              aria-label="Search inventory"
            />
          </label>
          <div className={styles.filters} aria-label="Inventory filters">
            {(["all", "low", "out"] as StockFilter[]).map((item) => (
              <button
                key={item}
                type="button"
                className={filter === item ? styles.activeFilter : ""}
                onClick={() => setFilter(item)}
              >
                {item === "all" ? "All stock" : item === "low" ? "Low stock" : "Out of stock"}
              </button>
            ))}
          </div>
          <Badge tone="neutral">0 items</Badge>
        </div>

        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Item</th>
                <th>SKU</th>
                <th>Purpose</th>
                <th>Category</th>
                <th>On hand</th>
                <th>Reorder at</th>
                <th>Status</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody />
          </table>
        </div>

        <EmptyState
          icon={<PackageCheck size={24} />}
          title={query ? "No matching inventory" : "Inventory structure ready"}
          description={query
            ? "Search will become operational when product records are connected."
            : "The visual module is in place. Product records, quantities and movement history are the next functional layer."}
        />
      </Card>

      <div className={styles.lowerGrid}>
        <Card className={styles.workflowCard}>
          <div className={styles.cardIcon}><ClipboardList size={20} /></div>
          <p className="eyebrow">Supplier workflow</p>
          <h2>Document to stock movement</h2>
          <p className="muted">
            The approved workflow will capture a supplier invoice or credit note, review extracted lines, then create controlled inventory movements.
          </p>
          <ol>
            <li><span>1</span>Choose or photograph a supplier document</li>
            <li><span>2</span>Review supplier, type, quantities and costs</li>
            <li><span>3</span>Confirm the stock movement and document record</li>
          </ol>
        </Card>

        <Card className={styles.workflowCard}>
          <div className={styles.cardIcon}><FileSearch size={20} /></div>
          <p className="eyebrow">Migration boundary</p>
          <h2>Visual approval before data logic</h2>
          <p className="muted">
            This phase deliberately excludes uploads, AI extraction, products, suppliers, stock quantities and accounting entries. Those functions will be restored only after the layout is approved.
          </p>
          <div className={styles.scopeBadges}>
            <Badge tone="gold">Inventory shell</Badge>
            <Badge tone="gold">Import window</Badge>
            <Badge tone="neutral">No writes</Badge>
          </div>
        </Card>
      </div>

      <Dialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        title="Import supplier document"
        description="Visual preview of the Vanita invoice and credit-note workflow inside BDB OS."
      >
        <div className={styles.dialogBody}>
          <div className={styles.stepper} aria-label="Import progress">
            {importSteps.map((step, index) => (
              <div key={step} className={index === 0 ? styles.activeStep : ""}>
                <span>{index + 1}</span>
                <strong>{step}</strong>
              </div>
            ))}
          </div>

          <div className={styles.importGrid}>
            <div className={styles.uploadZone}>
              <div className={styles.uploadIcon}><UploadCloud size={28} /></div>
              <h3>Take a photo or choose a file</h3>
              <p>Supplier invoice or credit note · PDF, JPG or PNG</p>
              <Button type="button" disabled>Choose document</Button>
              <small>File selection is intentionally disabled during visual review.</small>
            </div>

            <div className={styles.reviewPreview}>
              <div>
                <p className="eyebrow">Review structure</p>
                <h3>Extracted document details</h3>
                <p className="muted small">These fields show the planned review step. They do not accept or save data yet.</p>
              </div>
              <div className={styles.previewFields}>
                <label>Supplier<input disabled placeholder="Supplier name" /></label>
                <label>Document type<select disabled defaultValue="invoice"><option value="invoice">Invoice</option><option value="credit">Credit note</option></select></label>
                <label>Item purpose<select disabled defaultValue="resale"><option value="resale">Resale stock</option><option value="supply">Business supplies</option></select></label>
                <label>Document number<input disabled placeholder="INV-0000" /></label>
              </div>
              <div className={styles.linePreview}>
                <span>Product lines</span><span>Quantity</span><span>Unit cost</span><span>Stock action</span>
              </div>
            </div>
          </div>
        </div>
        <div className="dialog-actions">
          <Button type="button" variant="quiet" onClick={() => setImportOpen(false)}>Close preview</Button>
          <Button type="button" disabled>Review document</Button>
        </div>
      </Dialog>
    </>
  );
}
