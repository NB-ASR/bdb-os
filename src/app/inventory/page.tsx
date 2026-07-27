"use client";

import Link from "next/link";
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
} from "lucide-react";
import { useBdb } from "@/lib/store";
import { Badge, Button, Card, EmptyState, PageHeader, StatCard } from "@/components/ui";
import styles from "./inventory.module.css";

type StockFilter = "all" | "low" | "out";

export default function InventoryPage() {
  const { state, role } = useBdb();
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
        description="Monitor stock on hand, restock levels and the movements created from approved purchasing documents."
        action={(
          <div className={styles.headerActions}>
            <Button variant="secondary" disabled title="Product creation will be connected after the shared catalogue schema is approved">
              <Boxes size={17} /> Add item
            </Button>
            <Link href="/documents/purchasing" className="button button-primary">
              <ScanLine size={17} /> Open Purchasing
            </Link>
          </div>
        )}
      />

      <div className="review-callout">
        <Sparkles size={19} />
        <div>
          <strong>Visual migration preview</strong>
          <p>No products, quantities or stock movements can be created from this screen yet. Supplier documents are now reviewed once through Documents → Purchasing.</p>
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
          <p className="eyebrow">Purchasing connection</p>
          <h2>Approved document to stock movement</h2>
          <p className="muted">Documents owns the supplier file and review process. After approval, Inventory receives a controlled command to create stock receipts or credit-note reversals.</p>
          <ol>
            <li><span>1</span>Upload and review the supplier document in Purchasing</li>
            <li><span>2</span>Approve supplier, product, quantity and cost matching</li>
            <li><span>3</span>Create auditable Inventory ledger movements</li>
          </ol>
        </Card>

        <Card className={styles.workflowCard}>
          <div className={styles.cardIcon}><FileSearch size={20} /></div>
          <p className="eyebrow">Record boundary</p>
          <h2>No duplicate supplier documents</h2>
          <p className="muted">Inventory references the shared purchasing document and its lines. It does not store a second copy of the invoice, credit note or payable balance.</p>
          <div className={styles.scopeBadges}>
            <Badge tone="gold">Inventory ledger</Badge>
            <Badge tone="blue">Purchasing reference</Badge>
            <Badge tone="neutral">No writes yet</Badge>
          </div>
        </Card>
      </div>
    </>
  );
}
