"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Boxes, FileCheck2, RefreshCw } from "lucide-react";
import { Badge, Button, Card } from "@/components/ui";
import styles from "./purchasing-status.module.css";

type PostingStatus = "ready" | "posted" | "reversed";

type PurchasingDocument = {
  id: string;
  document_number: string | null;
  file_name: string;
  inventory_posting_status: PostingStatus;
  supplier: { name: string } | null;
};

function statusLabel(status: PostingStatus) {
  if (status === "ready") return "Ready to post";
  if (status === "posted") return "Posted";
  return "Reversed";
}

export default function PurchasingInventoryStatus() {
  const [documents, setDocuments] = useState<PurchasingDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const contextResponse = await fetch("/api/workspace/context", { cache: "no-store" });
      const context = await contextResponse.json().catch(() => ({}));
      if (!contextResponse.ok || !context.currentWorkspaceId) return;
      const response = await fetch(
        `/api/inventory?workspaceId=${encodeURIComponent(String(context.currentWorkspaceId))}`,
        { cache: "no-store" },
      );
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) throw new Error(result.error ?? "Inventory posting status could not be loaded.");
      setDocuments((result.result?.purchasingDocuments ?? []) as PurchasingDocument[]);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Inventory posting status could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const ready = documents.filter((document) => document.inventory_posting_status === "ready").length;
  const posted = documents.filter((document) => document.inventory_posting_status === "posted").length;
  const reversed = documents.filter((document) => document.inventory_posting_status === "reversed").length;

  return (
    <Card className={styles.statusCard}>
      <div className={styles.header}>
        <div className={styles.icon}><Boxes size={20} /></div>
        <div className={styles.heading}>
          <p className="eyebrow">Downstream Inventory</p>
          <h2>Approved-document posting</h2>
          <p>Approval preserves the reviewed source document. Stock changes are posted separately through the immutable Inventory ledger.</p>
        </div>
        <div className={styles.actions}>
          <Button variant="quiet" onClick={() => void load()} disabled={loading}>
            <RefreshCw size={15} className={loading ? "spin" : ""} /> Refresh
          </Button>
          <Link href="/inventory" className="button button-primary"><FileCheck2 size={16} /> Open Inventory</Link>
        </div>
      </div>
      {error ? <p className={styles.error}>{error}</p> : null}
      <div className={styles.metrics}>
        <div><strong>{ready}</strong><span>Ready to post</span><Badge tone={ready ? "gold" : "neutral"}>Approved</Badge></div>
        <div><strong>{posted}</strong><span>Posted to stock</span><Badge tone={posted ? "green" : "neutral"}>Ledger active</Badge></div>
        <div><strong>{reversed}</strong><span>Posting reversed</span><Badge tone="neutral">History retained</Badge></div>
      </div>
      {documents.length ? (
        <div className={styles.documentStrip}>
          {documents.slice(0, 5).map((document) => (
            <div key={document.id}>
              <span>{document.document_number || document.file_name}</span>
              <small>{document.supplier?.name || "Supplier"}</small>
              <Badge tone={document.inventory_posting_status === "ready" ? "gold" : document.inventory_posting_status === "posted" ? "green" : "neutral"}>
                {statusLabel(document.inventory_posting_status)}
              </Badge>
            </div>
          ))}
        </div>
      ) : null}
    </Card>
  );
}
