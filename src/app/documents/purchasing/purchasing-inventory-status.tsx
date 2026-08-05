"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Boxes, FileCheck2, MapPin, RefreshCw, TriangleAlert } from "lucide-react";
import { Badge, Button, Card } from "@/components/ui";
import styles from "./purchasing-status.module.css";

type PostingStatus = "ready" | "posted" | "reversed";

type PurchasingDocument = {
  id: string;
  document_number: string | null;
  document_type: "invoice" | "credit_note";
  file_name: string;
  inventory_posting_status: PostingStatus;
  supplier: { name: string } | null;
};

type InventoryLocation = {
  id: string;
  code: string;
  name: string;
  is_default: boolean;
  status: "active" | "archived";
};

type InventoryBundle = {
  purchasingDocuments?: PurchasingDocument[];
  locations?: InventoryLocation[];
};

function statusLabel(status: PostingStatus) {
  if (status === "ready") return "Ready to post";
  if (status === "posted") return "Posted";
  return "Reversed";
}

function documentTypeLabel(type: PurchasingDocument["document_type"]) {
  return type === "credit_note" ? "Credit note" : "Supplier invoice";
}

export default function PurchasingInventoryStatus() {
  const [workspaceId, setWorkspaceId] = useState("");
  const [documents, setDocuments] = useState<PurchasingDocument[]>([]);
  const [locations, setLocations] = useState<InventoryLocation[]>([]);
  const [receivingLocationId, setReceivingLocationId] = useState("");
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const activeLocations = useMemo(
    () => locations.filter((location) => location.status === "active"),
    [locations],
  );

  const load = useCallback(async () => {
    setError("");
    try {
      const contextResponse = await fetch("/api/workspace/context", { cache: "no-store" });
      const context = await contextResponse.json().catch(() => ({}));
      if (!contextResponse.ok || !context.currentWorkspaceId) {
        throw new Error(context.error ?? "The current workspace could not be resolved.");
      }

      const currentWorkspaceId = String(context.currentWorkspaceId);
      const response = await fetch(
        `/api/inventory?workspaceId=${encodeURIComponent(currentWorkspaceId)}`,
        { cache: "no-store" },
      );
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) {
        throw new Error(result.error ?? "Inventory posting status could not be loaded.");
      }

      const bundle = (result.result ?? {}) as InventoryBundle;
      const nextLocations = bundle.locations ?? [];
      const nextActiveLocations = nextLocations.filter((location) => location.status === "active");
      const preferredLocation = nextActiveLocations.find((location) => location.is_default)
        ?? nextActiveLocations[0]
        ?? null;

      setWorkspaceId(currentWorkspaceId);
      setDocuments(bundle.purchasingDocuments ?? []);
      setLocations(nextLocations);
      setReceivingLocationId((current) => nextActiveLocations.some((location) => location.id === current)
        ? current
        : preferredLocation?.id ?? "");
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

  async function runInventoryCommand(
    action: string,
    payload: Record<string, unknown>,
    idempotencyKey: string,
  ) {
    if (!workspaceId) throw new Error("The current workspace could not be resolved.");
    const response = await fetch("/api/inventory", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify({ workspaceId, action, ...payload }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.ok) {
      throw new Error(result.error ?? "The Inventory command failed.");
    }
    return result.result as Record<string, unknown>;
  }

  async function createMainLocation() {
    if (!workspaceId || busyKey) return;
    setBusyKey("location");
    setError("");
    setNotice("");
    try {
      await runInventoryCommand(
        "create-location",
        {
          id: crypto.randomUUID(),
          code: "MAIN",
          name: "Main stock",
          isDefault: true,
        },
        `inventory-default-location:${workspaceId}`,
      );
      setNotice("Main stock was created as the default receiving location.");
      await load();
    } catch (commandError) {
      setError(commandError instanceof Error ? commandError.message : "The default stock location could not be created.");
    } finally {
      setBusyKey("");
    }
  }

  async function postDocument(document: PurchasingDocument) {
    if (!workspaceId || !receivingLocationId || busyKey) return;
    setBusyKey(document.id);
    setError("");
    setNotice("");
    try {
      await runInventoryCommand(
        "post-purchasing-document",
        {
          documentId: document.id,
          locationId: receivingLocationId,
        },
        `inventory-post-document:${document.id}`,
      );
      setNotice(
        document.document_type === "credit_note"
          ? "The approved credit note was posted as immutable Supplier-return movements."
          : "The approved supplier invoice was posted as immutable purchase-receipt movements.",
      );
      await load();
    } catch (commandError) {
      setError(commandError instanceof Error ? commandError.message : "The approved document could not be posted.");
    } finally {
      setBusyKey("");
    }
  }

  const ready = documents.filter((document) => document.inventory_posting_status === "ready").length;
  const posted = documents.filter((document) => document.inventory_posting_status === "posted").length;
  const reversed = documents.filter((document) => document.inventory_posting_status === "reversed").length;
  const selectedLocation = activeLocations.find((location) => location.id === receivingLocationId) ?? null;

  return (
    <Card className={styles.statusCard}>
      <div className={styles.header}>
        <div className={styles.icon}><Boxes size={20} /></div>
        <div className={styles.heading}>
          <p className="eyebrow">Purchasing → Inventory</p>
          <h2>Movement ledger connected</h2>
          <p>Approve the reviewed source document, then post its Product lines to one receiving location. Each line becomes one immutable ledger movement.</p>
        </div>
        <div className={styles.actions}>
          <Button variant="quiet" onClick={() => void load()} disabled={loading || Boolean(busyKey)}>
            <RefreshCw size={15} className={loading ? "spin" : ""} /> Refresh
          </Button>
          <Link href="/inventory" className="button button-secondary"><FileCheck2 size={16} /> Open full ledger</Link>
        </div>
      </div>

      {error ? <div className={styles.error}><TriangleAlert size={16} /><span>{error}</span></div> : null}
      {notice ? <div className={styles.notice}>{notice}</div> : null}

      {!activeLocations.length ? (
        <div className={styles.setup}>
          <div><MapPin size={18} /><span><strong>A receiving location is required</strong><small>Create the first default location before posting approved invoices or credit notes.</small></span></div>
          <Button onClick={() => void createMainLocation()} disabled={loading || Boolean(busyKey)}>
            {busyKey === "location" ? <RefreshCw size={16} className="spin" /> : <MapPin size={16} />} Create Main stock
          </Button>
        </div>
      ) : (
        <label className={styles.locationSelect}>
          <span>Receiving location</span>
          <select
            value={receivingLocationId}
            onChange={(event) => setReceivingLocationId(event.target.value)}
            disabled={Boolean(busyKey)}
          >
            {activeLocations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.name} · {location.code}{location.is_default ? " · Default" : ""}
              </option>
            ))}
          </select>
          <small>{selectedLocation ? `New stock will be received into ${selectedLocation.name}.` : "Choose where the stock was received."}</small>
        </label>
      )}

      <div className={styles.metrics}>
        <div><strong>{ready}</strong><span>Ready to post</span><Badge tone={ready ? "gold" : "neutral"}>Approved</Badge></div>
        <div><strong>{posted}</strong><span>Posted to stock</span><Badge tone={posted ? "green" : "neutral"}>Ledger active</Badge></div>
        <div><strong>{reversed}</strong><span>Posting reversed</span><Badge tone="neutral">History retained</Badge></div>
      </div>

      {documents.length ? (
        <div className={styles.documentStrip}>
          {documents.map((document) => (
            <div key={document.id}>
              <span>{document.document_number || document.file_name}</span>
              <small>{document.supplier?.name || "Supplier"} · {documentTypeLabel(document.document_type)}</small>
              <Badge tone={document.inventory_posting_status === "ready" ? "gold" : document.inventory_posting_status === "posted" ? "green" : "neutral"}>
                {statusLabel(document.inventory_posting_status)}
              </Badge>
              <div className={styles.rowActions}>
                {document.inventory_posting_status === "ready" ? (
                  <Button
                    variant="secondary"
                    onClick={() => void postDocument(document)}
                    disabled={!receivingLocationId || Boolean(busyKey)}
                  >
                    {busyKey === document.id ? <RefreshCw size={15} className="spin" /> : <FileCheck2 size={15} />}
                    {document.document_type === "credit_note" ? "Post return" : "Receive stock"}
                  </Button>
                ) : document.inventory_posting_status === "posted" ? (
                  <Link href="/inventory" className="button button-quiet">View movements</Link>
                ) : (
                  <Link href="/inventory" className="button button-quiet">View reversal</Link>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className={styles.empty}>No approved supplier documents are waiting. Approve a reviewed invoice above and it will appear here immediately.</p>
      )}
    </Card>
  );
}
