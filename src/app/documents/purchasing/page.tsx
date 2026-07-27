"use client";

import { useMemo, useState } from "react";
import {
  AlertTriangle,
  Boxes,
  CheckCircle2,
  CircleDollarSign,
  Eye,
  FileCheck2,
  FileText,
  PackageCheck,
  ScanLine,
  Search,
  Sparkles,
  Truck,
  UploadCloud,
  WalletCards,
} from "lucide-react";
import { useBdb } from "@/lib/store";
import { formatMoney } from "@/lib/format";
import { Badge, Button, Card, Dialog, PageHeader, StatCard } from "@/components/ui";
import styles from "./purchasing.module.css";

type DocumentFilter = "all" | "review" | "posting" | "complete";
type DocumentType = "Supplier invoice" | "Credit note";
type ReviewStatus = "Needs review" | "Reviewed" | "Approved";
type PostingStatus = "Not posted" | "Ready" | "Posted" | "Reversed";
type PaymentStatus = "Unpaid" | "Part paid" | "Paid" | "Credited";

type PreviewPurchasingDocument = {
  reference: string;
  supplier: string;
  supplierCode: string;
  type: DocumentType;
  documentNumber: string;
  documentDate: string;
  dueDate: string;
  gross: number;
  discount: number;
  vat: number;
  total: number;
  extraction: "Extracted" | "Manual review";
  review: ReviewStatus;
  productMatch: "Matched" | "Attention";
  inventory: PostingStatus;
  accounts: PostingStatus;
  payment: PaymentStatus;
  lines: number;
};

const previewDocuments: PreviewPurchasingDocument[] = [
  {
    reference: "PUR-2026-0048",
    supplier: "Collis Williams",
    supplierCode: "SUP-CW",
    type: "Supplier invoice",
    documentNumber: "CW-11842",
    documentDate: "24 Jul 2026",
    dueDate: "23 Aug 2026",
    gross: 684,
    discount: 68.4,
    vat: 110.81,
    total: 726.41,
    extraction: "Extracted",
    review: "Approved",
    productMatch: "Matched",
    inventory: "Posted",
    accounts: "Posted",
    payment: "Unpaid",
    lines: 8,
  },
  {
    reference: "PUR-2026-0047",
    supplier: "Salon Supply Co.",
    supplierCode: "SUP-SSC",
    type: "Supplier invoice",
    documentNumber: "SSC-7741",
    documentDate: "22 Jul 2026",
    dueDate: "05 Aug 2026",
    gross: 238.5,
    discount: 28.62,
    vat: 37.78,
    total: 247.66,
    extraction: "Extracted",
    review: "Reviewed",
    productMatch: "Attention",
    inventory: "Ready",
    accounts: "Not posted",
    payment: "Unpaid",
    lines: 4,
  },
  {
    reference: "PUR-2026-0046",
    supplier: "Makiba Essence",
    supplierCode: "SUP-MAK",
    type: "Credit note",
    documentNumber: "CN-2026-91",
    documentDate: "19 Jul 2026",
    dueDate: "Not applicable",
    gross: -96,
    discount: 0,
    vat: -17.28,
    total: -113.28,
    extraction: "Manual review",
    review: "Needs review",
    productMatch: "Matched",
    inventory: "Not posted",
    accounts: "Not posted",
    payment: "Credited",
    lines: 2,
  },
  {
    reference: "PUR-2026-0045",
    supplier: "Collis Williams",
    supplierCode: "SUP-CW",
    type: "Supplier invoice",
    documentNumber: "CW-11690",
    documentDate: "11 Jul 2026",
    dueDate: "10 Aug 2026",
    gross: 412,
    discount: 41.2,
    vat: 66.74,
    total: 437.54,
    extraction: "Extracted",
    review: "Approved",
    productMatch: "Matched",
    inventory: "Posted",
    accounts: "Posted",
    payment: "Paid",
    lines: 5,
  },
];

const workflowSteps = ["Upload", "Review", "Complete"];

function postingTone(status: PostingStatus) {
  if (status === "Posted") return "green" as const;
  if (status === "Ready") return "gold" as const;
  if (status === "Reversed") return "blue" as const;
  return "neutral" as const;
}

function reviewTone(status: ReviewStatus) {
  if (status === "Approved") return "green" as const;
  if (status === "Reviewed") return "blue" as const;
  return "gold" as const;
}

function paymentTone(status: PaymentStatus) {
  if (status === "Paid" || status === "Credited") return "green" as const;
  if (status === "Part paid") return "gold" as const;
  return "neutral" as const;
}

export default function PurchasingPage() {
  const { state, role } = useBdb();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<DocumentFilter>("all");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [selected, setSelected] = useState<PreviewPurchasingDocument | null>(null);
  const supportMode = role === "platform-support";

  const visibleDocuments = useMemo(() => {
    const term = query.trim().toLowerCase();
    return previewDocuments.filter((document) => {
      const matchesSearch = !term || [
        document.reference,
        document.supplier,
        document.supplierCode,
        document.type,
        document.documentNumber,
        document.review,
        document.inventory,
        document.accounts,
        document.payment,
      ].join(" ").toLowerCase().includes(term);
      const matchesFilter = filter === "all"
        || (filter === "review" && (document.review === "Needs review" || document.productMatch === "Attention"))
        || (filter === "posting" && (document.inventory !== "Posted" || document.accounts !== "Posted"))
        || (filter === "complete" && document.inventory === "Posted" && document.accounts === "Posted");
      return matchesSearch && matchesFilter;
    });
  }, [filter, query]);

  const awaitingReview = previewDocuments.filter((document) => document.review === "Needs review" || document.productMatch === "Attention").length;
  const readyToPost = previewDocuments.filter((document) => document.inventory === "Ready" || document.accounts === "Ready").length;
  const outstanding = previewDocuments
    .filter((document) => document.payment === "Unpaid" || document.payment === "Part paid")
    .reduce((total, document) => total + Math.max(0, document.total), 0);

  return (
    <>
      <PageHeader
        eyebrow="Supplier documents"
        title="Purchasing"
        description="Review supplier invoices and credit notes once, then connect the approved document to Inventory, Accounts and payment history."
        action={(
          <div className={styles.headerActions}>
            <Button variant="secondary" disabled title="Supplier-document import will be enabled after the shared purchasing schema is approved">
              <ScanLine size={17} /> Scan document
            </Button>
            <Button onClick={() => setUploadOpen(true)}>
              <UploadCloud size={17} /> Upload supplier document
            </Button>
          </div>
        )}
      />

      <div className="review-callout">
        <Sparkles size={19} />
        <div>
          <strong>Visual migration preview</strong>
          <p>Rows below are representative design data only. No files, supplier documents, stock movements, bills or payments have been created.</p>
        </div>
      </div>

      {supportMode ? (
        <div className={styles.supportNotice}>
          <FileCheck2 size={18} />
          <div><strong>Founder support · Read only</strong><span>Document review and departmental posting remain blocked during the audited support session.</span></div>
        </div>
      ) : null}

      <div className="stat-grid">
        <StatCard label="Preview documents" value={String(previewDocuments.length)} detail="Representative supplier records" icon={<FileText size={19} />} />
        <StatCard label="Needs attention" value={String(awaitingReview)} detail="Review or product matching" icon={<AlertTriangle size={19} />} />
        <StatCard label="Ready to post" value={String(readyToPost)} detail="Awaiting controlled posting" icon={<PackageCheck size={19} />} />
        <StatCard label="Outstanding" value={formatMoney(outstanding, state.settings.currency)} detail="Preview unpaid supplier value" icon={<CircleDollarSign size={19} />} />
      </div>

      <Card className={styles.registerCard}>
        <div className={styles.toolbar}>
          <label className={styles.searchField}>
            <Search size={17} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search supplier, document number, reference or status…"
              aria-label="Search purchasing documents"
            />
          </label>
          <div className={styles.filters} aria-label="Purchasing document filters">
            {(["all", "review", "posting", "complete"] as DocumentFilter[]).map((item) => (
              <button
                key={item}
                type="button"
                className={filter === item ? styles.activeFilter : ""}
                onClick={() => setFilter(item)}
              >
                {item === "all" ? "All" : item === "review" ? "Needs review" : item === "posting" ? "Posting" : "Complete"}
              </button>
            ))}
          </div>
          <Badge tone="neutral">{visibleDocuments.length} preview rows</Badge>
        </div>

        <div className="table-scroll">
          <table className={styles.documentTable}>
            <thead>
              <tr>
                <th>Document</th>
                <th>Supplier</th>
                <th>Date / due</th>
                <th>Lines</th>
                <th>Total</th>
                <th>Review</th>
                <th>Product match</th>
                <th>Inventory</th>
                <th>Accounts</th>
                <th>Payment</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {visibleDocuments.map((document) => (
                <tr key={document.reference}>
                  <td>
                    <div className={styles.documentIdentity}>
                      <span>{document.type === "Credit note" ? <FileCheck2 size={17} /> : <FileText size={17} />}</span>
                      <div><strong>{document.documentNumber}</strong><small>{document.reference} · {document.type}</small></div>
                    </div>
                  </td>
                  <td><div className={styles.supplierCell}><strong>{document.supplier}</strong><small>{document.supplierCode}</small></div></td>
                  <td><div className={styles.statusStack}><strong>{document.documentDate}</strong><small>Due {document.dueDate}</small></div></td>
                  <td>{document.lines}</td>
                  <td><div className={styles.amountCell}><strong>{formatMoney(document.total, state.settings.currency)}</strong><small>VAT {formatMoney(document.vat, state.settings.currency)}</small></div></td>
                  <td><div className={styles.statusStack}><Badge tone={reviewTone(document.review)}>{document.review}</Badge><small>{document.extraction}</small></div></td>
                  <td><Badge tone={document.productMatch === "Matched" ? "green" : "gold"}>{document.productMatch}</Badge></td>
                  <td><Badge tone={postingTone(document.inventory)}>{document.inventory}</Badge></td>
                  <td><Badge tone={postingTone(document.accounts)}>{document.accounts}</Badge></td>
                  <td><Badge tone={paymentTone(document.payment)}>{document.payment}</Badge></td>
                  <td><Button type="button" variant="quiet" onClick={() => setSelected(document)}><Eye size={16} /> View</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {visibleDocuments.length === 0 ? (
          <div className={styles.emptyState}>
            <FileText size={23} />
            <h3>No preview documents match</h3>
            <p>Change the search term or purchasing filter.</p>
          </div>
        ) : null}
      </Card>

      <div className={styles.lowerGrid}>
        <Card className={styles.guidanceCard}>
          <div className={styles.guidanceIcon}><Boxes size={20} /></div>
          <p className="eyebrow">Inventory boundary</p>
          <h2>Posting creates ledger movements</h2>
          <p className="muted">An approved supplier invoice may create stock receipts; an approved credit note may create controlled reversals. Purchasing does not directly edit stock-on-hand.</p>
        </Card>
        <Card className={styles.guidanceCard}>
          <div className={styles.guidanceIcon}><WalletCards size={20} /></div>
          <p className="eyebrow">Accounts boundary</p>
          <h2>One source document, one payable history</h2>
          <p className="muted">Accounts receives the approved totals and payment terms from this document. Banking remains responsible for settlement and reconciliation.</p>
        </Card>
      </div>

      <Dialog
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        title="Upload supplier document"
        description="Visual preview of the shared supplier invoice and credit-note workflow. No file is selected or stored."
        className={styles.purchasingDialog}
      >
        <div className={styles.dialogBody}>
          <div className={styles.stepper} aria-label="Purchasing document progress">
            {workflowSteps.map((step, index) => (
              <div key={step} className={index === 0 ? styles.activeStep : ""}>
                <span>{index + 1}</span><strong>{step}</strong>
              </div>
            ))}
          </div>

          <div className={styles.importGrid}>
            <div className={styles.uploadZone}>
              <div className={styles.uploadIcon}><UploadCloud size={28} /></div>
              <h3>Choose or photograph a document</h3>
              <p>Supplier invoice or credit note · PDF, JPG or PNG</p>
              <Button type="button" disabled>Choose document</Button>
              <small>File selection is intentionally disabled during visual review.</small>
            </div>

            <div className={styles.reviewPanel}>
              <div>
                <p className="eyebrow">Review structure</p>
                <h3>Extracted supplier document</h3>
                <p className="muted small">These fields define the planned validation step. They do not accept or save data.</p>
              </div>
              <div className={styles.previewFields}>
                <label>Supplier<input disabled placeholder="Match or create supplier" /></label>
                <label>Document type<select disabled defaultValue="invoice"><option value="invoice">Supplier invoice</option><option value="credit">Credit note</option></select></label>
                <label>Document number<input disabled placeholder="INV-0000" /></label>
                <label>Document date<input disabled placeholder="DD/MM/YYYY" /></label>
                <label>Payment terms<select disabled defaultValue="30"><option value="receipt">Due on receipt</option><option value="14">14 days</option><option value="30">30 days</option></select></label>
                <label>Currency<select disabled defaultValue={state.settings.currency}><option value={state.settings.currency}>{state.settings.currency}</option></select></label>
              </div>
              <div className={styles.linePreview}>
                <span>Product or expense line</span><span>Quantity</span><span>Unit cost</span><span>Posting action</span>
              </div>
              <div className={styles.boundaryNote}>
                <Truck size={18} />
                <div><strong>Validate once before posting</strong><span>Supplier, products, quantities, VAT and totals must be approved before Inventory or Accounts receives a posting command.</span></div>
              </div>
            </div>
          </div>
        </div>
        <div className="dialog-actions">
          <Button type="button" variant="quiet" onClick={() => setUploadOpen(false)}>Close preview</Button>
          <Button type="button" disabled>Review document</Button>
        </div>
      </Dialog>

      <Dialog
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        title="Purchasing document"
        description="One supplier document with controlled review, Inventory, Accounts and payment states."
        className={styles.detailDialog}
      >
        {selected ? (
          <div className={styles.dialogBody}>
            <div className={styles.detailHero}>
              <div><p className="eyebrow">{selected.reference}</p><h3>{selected.documentNumber}</h3><p className="muted">{selected.supplier} · {selected.type}</p></div>
              <Badge tone={reviewTone(selected.review)}>{selected.review}</Badge>
            </div>
            <div className={styles.detailGrid}>
              <div className={styles.detailPanel}>
                <h3>Document details</h3>
                <div className={styles.detailList}>
                  <div className={styles.detailItem}><span>Supplier</span><strong>{selected.supplier}</strong></div>
                  <div className={styles.detailItem}><span>Document date</span><strong>{selected.documentDate}</strong></div>
                  <div className={styles.detailItem}><span>Due date</span><strong>{selected.dueDate}</strong></div>
                  <div className={styles.detailItem}><span>Lines</span><strong>{selected.lines}</strong></div>
                  <div className={styles.detailItem}><span>Gross</span><strong>{formatMoney(selected.gross, state.settings.currency)}</strong></div>
                  <div className={styles.detailItem}><span>Discount</span><strong>{formatMoney(selected.discount, state.settings.currency)}</strong></div>
                  <div className={styles.detailItem}><span>VAT</span><strong>{formatMoney(selected.vat, state.settings.currency)}</strong></div>
                  <div className={styles.detailItem}><span>Total</span><strong>{formatMoney(selected.total, state.settings.currency)}</strong></div>
                </div>
              </div>
              <div className={styles.timelinePanel}>
                <h3>Posting lifecycle</h3>
                <div className={styles.timeline}>
                  <div className={styles.timelineItem}><span>1</span><div><strong>{selected.extraction}</strong><small>Original file and extracted metadata remain owned by Documents.</small></div></div>
                  <div className={styles.timelineItem}><span>2</span><div><strong>{selected.review}</strong><small>Supplier, products, quantities, discounts, VAT and totals reviewed.</small></div></div>
                  <div className={styles.timelineItem}><span>3</span><div><strong>Inventory · {selected.inventory}</strong><small>Stock receipts or reversals remain Inventory ledger records.</small></div></div>
                  <div className={styles.timelineItem}><span>4</span><div><strong>Accounts · {selected.accounts}</strong><small>Payable and balance remain Accounts records.</small></div></div>
                  <div className={styles.timelineItem}><span>5</span><div><strong>Payment · {selected.payment}</strong><small>Settlement and reconciliation remain Banking responsibilities.</small></div></div>
                </div>
              </div>
            </div>
          </div>
        ) : null}
        <div className="dialog-actions">
          <Button type="button" variant="quiet" onClick={() => setSelected(null)}>Close</Button>
          <Button type="button" disabled><CheckCircle2 size={16} /> Approve and post</Button>
        </div>
      </Dialog>
    </>
  );
}
