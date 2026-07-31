"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { CircleDollarSign, FileCheck2, RefreshCw, TriangleAlert } from "lucide-react";
import { Badge, Button, Card } from "@/components/ui";
import { formatMoney } from "@/lib/format";
import styles from "./purchasing-status.module.css";

type SourceDocument = {
  id: string;
  document_number: string;
  document_type: "invoice" | "credit_note";
  currency: string;
  gross_amount: number;
  accounts_posting_status: "ready" | "posted" | "reversed";
  supplier: { name: string } | null;
};

function statusLabel(status: SourceDocument["accounts_posting_status"]) {
  if (status === "ready") return "Ready to post";
  if (status === "posted") return "Posted";
  return "Reversed";
}

export default function PurchasingAccountsStatus() {
  const [workspaceId, setWorkspaceId] = useState("");
  const [documents, setDocuments] = useState<SourceDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const contextResponse = await fetch("/api/workspace/context", { cache: "no-store" });
      const context = await contextResponse.json().catch(() => ({}));
      if (!contextResponse.ok || !context.currentWorkspaceId) {
        throw new Error(context.error ?? "The current workspace could not be resolved.");
      }
      const currentWorkspaceId = String(context.currentWorkspaceId);
      const response = await fetch(`/api/supplier-payables?workspaceId=${encodeURIComponent(currentWorkspaceId)}`, { cache: "no-store" });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) throw new Error(result.error ?? "Accounts Payable status could not be loaded.");
      setWorkspaceId(currentWorkspaceId);
      setDocuments((result.result?.documents ?? []) as SourceDocument[]);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Accounts Payable status could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function postDocument(document: SourceDocument) {
    if (!workspaceId || busyKey) return;
    setBusyKey(document.id);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/supplier-payables", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify({
          workspaceId,
          action: "payable-post",
          id: crypto.randomUUID(),
          supplierDocumentId: document.id,
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) throw new Error(result.error ?? "The document could not be posted to Accounts Payable.");
      setNotice(document.document_type === "credit_note"
        ? "The credit note is now available as Supplier credit in Accounts Payable."
        : "The Supplier invoice is now recorded as an amount owed in Accounts Payable.");
      await load();
    } catch (commandError) {
      setError(commandError instanceof Error ? commandError.message : "The document could not be posted to Accounts Payable.");
    } finally {
      setBusyKey("");
    }
  }

  const ready = documents.filter((document) => document.accounts_posting_status === "ready" || document.accounts_posting_status === "reversed").length;
  const posted = documents.filter((document) => document.accounts_posting_status === "posted").length;

  return (
    <Card className={styles.statusCard}>
      <div className={styles.header}>
        <div className={styles.icon}><CircleDollarSign size={20} /></div>
        <div className={styles.heading}>
          <p className="eyebrow">Purchasing → Accounts Payable</p>
          <h2>Supplier ledger connected</h2>
          <p>Approval confirms the source document. Posting to Accounts explicitly creates an immutable payable or Supplier credit without changing Inventory or Banking.</p>
        </div>
        <div className={styles.actions}>
          <Button variant="quiet" onClick={() => void load()} disabled={loading || Boolean(busyKey)}><RefreshCw size={15} className={loading ? "spin" : ""} /> Refresh</Button>
          <Link href="/accounts/payables" className="button button-secondary"><CircleDollarSign size={16} /> Open Supplier Payables</Link>
        </div>
      </div>

      {error ? <div className={styles.error}><TriangleAlert size={16} /><span>{error}</span></div> : null}
      {notice ? <div className={styles.notice}>{notice}</div> : null}

      <div className={styles.metrics}>
        <div><strong>{ready}</strong><span>Ready to post</span><Badge tone={ready ? "gold" : "neutral"}>Approved</Badge></div>
        <div><strong>{posted}</strong><span>Posted to Accounts</span><Badge tone={posted ? "green" : "neutral"}>Ledger active</Badge></div>
        <div><strong>0</strong><span>Bank transactions created</span><Badge tone="neutral">Separate boundary</Badge></div>
      </div>

      {documents.length ? (
        <div className={styles.documentStrip}>
          {documents.map((document) => (
            <div key={document.id}>
              <span>{document.document_number}</span>
              <small>{document.supplier?.name ?? "Supplier"} · {formatMoney(Number(document.gross_amount), document.currency)}</small>
              <Badge tone={document.accounts_posting_status === "ready" ? "gold" : document.accounts_posting_status === "posted" ? "green" : "neutral"}>{statusLabel(document.accounts_posting_status)}</Badge>
              <div className={styles.rowActions}>
                {document.accounts_posting_status !== "posted" ? (
                  <Button variant="secondary" onClick={() => void postDocument(document)} disabled={Boolean(busyKey)}>
                    {busyKey === document.id ? <RefreshCw size={15} className="spin" /> : <FileCheck2 size={15} />}
                    Post to Accounts
                  </Button>
                ) : <Link href="/accounts/payables" className="button button-quiet">View payable</Link>}
              </div>
            </div>
          ))}
        </div>
      ) : <p className={styles.empty}>No approved Supplier documents are available for Accounts posting.</p>}
    </Card>
  );
}
