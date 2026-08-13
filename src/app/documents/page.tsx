"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import {
  AlertCircle,
  Archive,
  FileImage,
  Files,
  FileText,
  Link2,
  RefreshCw,
  ScanText,
  Settings2,
  UploadCloud,
  WifiOff,
  XCircle,
} from "lucide-react";
import { useBdb } from "@/lib/store";
import { formatDate } from "@/lib/format";
import { Badge, Button, Card, Dialog, PageHeader, StatCard } from "@/components/ui";
import {
  enqueueGeneralDocumentAction,
  enqueueGeneralDocumentUpload,
  flushGeneralDocumentQueue,
  listGeneralDocumentCommands,
} from "@/lib/modules/general-document-queue";

const MAX_FILE_SIZE = 10_000_000;
const CACHE_PREFIX = "bdb-general-documents-cache-v1";
const LAST_WORKSPACE_KEY = "bdb-general-documents-last-workspace-v1";

const LINK_TYPES = [
  ["business", "Business"],
  ["customer", "Customer"],
  ["appointment", "Appointment"],
  ["sale", "Sale"],
  ["invoice", "Invoice"],
  ["customer_payment", "Customer payment"],
  ["communication", "Communication"],
] as const;

type LinkType = typeof LINK_TYPES[number][0];

type DocumentLink = {
  id: string;
  type: LinkType;
  targetId: string | null;
  createdAt: string;
};

type GeneralDocument = {
  id: string;
  workspace_id: string;
  name: string;
  original_file_name: string | null;
  document_type: string;
  mime_type: string | null;
  size_label: string;
  size_bytes: number | null;
  category: string;
  description: string | null;
  status: "active" | "archived";
  storage_path: string;
  uploaded_at: string;
  created_by: string | null;
  archived_at: string | null;
  archived_by: string | null;
  links: DocumentLink[];
};

type LinkTarget = {
  id: string | null;
  label: string;
  detail: string;
};

type TargetBundle = Record<LinkType, LinkTarget[]>;

type CacheBundle = {
  workspaceId: string;
  documents: GeneralDocument[];
  targets: TargetBundle;
  access: Record<string, boolean>;
  cachedAt: string;
};

const emptyTargets = (): TargetBundle => ({
  business: [{ id: null, label: "Business", detail: "General business file" }],
  customer: [],
  appointment: [],
  sale: [],
  invoice: [],
  customer_payment: [],
  communication: [],
});

const cacheKey = (workspaceId: string) => `${CACHE_PREFIX}:${workspaceId}`;

function readCache(workspaceId: string): CacheBundle | null {
  if (typeof window === "undefined") return null;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(cacheKey(workspaceId)) ?? "null") as CacheBundle | null;
    return parsed?.workspaceId === workspaceId ? parsed : null;
  } catch {
    window.localStorage.removeItem(cacheKey(workspaceId));
    return null;
  }
}

function writeCache(bundle: CacheBundle) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(cacheKey(bundle.workspaceId), JSON.stringify(bundle));
  window.localStorage.setItem(LAST_WORKSPACE_KEY, bundle.workspaceId);
}

function linkTypeLabel(value: LinkType) {
  return LINK_TYPES.find(([type]) => type === value)?.[1] ?? value.replaceAll("_", " ");
}

function targetLabel(targets: TargetBundle, link: DocumentLink) {
  if (link.type === "business") return "Business";
  return targets[link.type].find((target) => target.id === link.targetId)?.label
    ?? `${linkTypeLabel(link.type)} · ${String(link.targetId).slice(0, 8)}`;
}

function normaliseLinks(value: unknown): DocumentLink[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    const type = String(row.type ?? "") as LinkType;
    if (!LINK_TYPES.some(([allowed]) => allowed === type)) return [];
    return [{
      id: String(row.id ?? ""),
      type,
      targetId: row.targetId ? String(row.targetId) : null,
      createdAt: String(row.createdAt ?? ""),
    }];
  });
}

function normaliseDocuments(value: unknown): GeneralDocument[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const row = item as Record<string, unknown>;
    return {
      id: String(row.id),
      workspace_id: String(row.workspace_id),
      name: String(row.name),
      original_file_name: row.original_file_name ? String(row.original_file_name) : null,
      document_type: String(row.document_type),
      mime_type: row.mime_type ? String(row.mime_type) : null,
      size_label: String(row.size_label),
      size_bytes: row.size_bytes === null || row.size_bytes === undefined ? null : Number(row.size_bytes),
      category: String(row.category ?? "general"),
      description: row.description ? String(row.description) : null,
      status: row.status === "archived" ? "archived" : "active",
      storage_path: String(row.storage_path ?? ""),
      uploaded_at: String(row.uploaded_at),
      created_by: row.created_by ? String(row.created_by) : null,
      archived_at: row.archived_at ? String(row.archived_at) : null,
      archived_by: row.archived_by ? String(row.archived_by) : null,
      links: normaliseLinks(row.links),
    };
  });
}

export default function DocumentsPage() {
  const { mode } = useBdb();
  const inputRef = useRef<HTMLInputElement>(null);
  const [workspaceId, setWorkspaceId] = useState("");
  const [documents, setDocuments] = useState<GeneralDocument[]>([]);
  const [targets, setTargets] = useState<TargetBundle>(emptyTargets);
  const [access, setAccess] = useState<Record<string, boolean>>({});
  const [loaded, setLoaded] = useState(false);
  const [online, setOnline] = useState(true);
  const [busy, setBusy] = useState(false);
  const [supportReadOnly, setSupportReadOnly] = useState(false);
  const [queueCount, setQueueCount] = useState(0);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [query, setQuery] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadForm, setUploadForm] = useState({
    name: "",
    category: "general",
    description: "",
    linkType: "business" as LinkType,
    targetId: "",
  });
  const [managing, setManaging] = useState<GeneralDocument | null>(null);
  const [newLinkType, setNewLinkType] = useState<LinkType>("customer");
  const [newTargetId, setNewTargetId] = useState("");
  const [revokeReason, setRevokeReason] = useState("");
  const [archiveReason, setArchiveReason] = useState("");

  const refreshQueue = useCallback(async (targetWorkspaceId: string) => {
    const queue = await listGeneralDocumentCommands(targetWorkspaceId);
    setQueueCount(queue.length);
  }, []);

  const load = useCallback(async () => {
    const contextResponse = await fetch("/api/workspace/context", { cache: "no-store" });
    const context = await contextResponse.json().catch(() => ({}));
    if (!contextResponse.ok || !context.currentWorkspaceId) {
      throw new Error(context.error ?? "The current workspace could not be resolved.");
    }
    const currentWorkspaceId = String(context.currentWorkspaceId);
    setWorkspaceId(currentWorkspaceId);
    setSupportReadOnly(Boolean(context.supportAccess) && context.supportAccessMode !== "test_write");

    const [documentsResponse, targetsResponse] = await Promise.all([
      fetch(`/api/documents?workspaceId=${encodeURIComponent(currentWorkspaceId)}`, { cache: "no-store" }),
      fetch(`/api/documents/targets?workspaceId=${encodeURIComponent(currentWorkspaceId)}`, { cache: "no-store" }),
    ]);
    const [documentsJson, targetsJson] = await Promise.all([
      documentsResponse.json().catch(() => ({})),
      targetsResponse.json().catch(() => ({})),
    ]);
    if (!documentsResponse.ok || !documentsJson.ok) {
      throw new Error(documentsJson.error ?? "Documents could not be loaded.");
    }
    if (!targetsResponse.ok || !targetsJson.ok) {
      throw new Error(targetsJson.error ?? "Document links could not be loaded.");
    }

    const nextDocuments = normaliseDocuments(documentsJson.result?.documents ?? []);
    const nextTargets = { ...emptyTargets(), ...(targetsJson.result?.targets ?? {}) } as TargetBundle;
    const nextAccess = (targetsJson.result?.access ?? {}) as Record<string, boolean>;
    setDocuments(nextDocuments);
    setTargets(nextTargets);
    setAccess(nextAccess);
    writeCache({
      workspaceId: currentWorkspaceId,
      documents: nextDocuments,
      targets: nextTargets,
      access: nextAccess,
      cachedAt: new Date().toISOString(),
    });
    await refreshQueue(currentWorkspaceId);
    return currentWorkspaceId;
  }, [refreshQueue]);

  useEffect(() => {
    const update = () => setOnline(window.navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  useEffect(() => {
    let active = true;
    async function initialise() {
      const lastWorkspace = window.localStorage.getItem(LAST_WORKSPACE_KEY) ?? "";
      const cached = lastWorkspace ? readCache(lastWorkspace) : null;
      if (cached && active) {
        setWorkspaceId(cached.workspaceId);
        setDocuments(cached.documents);
        setTargets(cached.targets);
        setAccess(cached.access);
        await refreshQueue(cached.workspaceId);
      }
      try {
        if (mode === "demo") {
          if (!cached) setError("General Documents requires an active cloud workspace in this integration preview.");
          return;
        }
        if (!window.navigator.onLine) {
          if (cached) setNotice("Showing the cached Document index. Changes will remain queued until reconnection.");
          else setError("Documents needs one successful online load before it can reopen offline.");
          return;
        }
        await load();
      } catch (initialError) {
        if (!cached && active) setError(initialError instanceof Error ? initialError.message : "Documents could not be loaded.");
        else if (active) setNotice("Showing the cached Document index while cloud access is unavailable.");
      } finally {
        if (active) setLoaded(true);
      }
    }
    void initialise();
    return () => { active = false; };
  }, [load, mode, refreshQueue]);

  const syncQueue = useCallback(async () => {
    if (!workspaceId || !online || busy) return;
    setBusy(true);
    setError("");
    try {
      const completed = await flushGeneralDocumentQueue(workspaceId);
      await load();
      if (completed) setNotice(`${completed} Document command${completed === 1 ? "" : "s"} synced.`);
    } catch (syncError) {
      setError(syncError instanceof Error ? syncError.message : "Document synchronisation stopped on a conflict.");
      await refreshQueue(workspaceId);
    } finally {
      setBusy(false);
    }
  }, [busy, load, online, refreshQueue, workspaceId]);

  useEffect(() => {
    if (!online || !workspaceId || queueCount === 0 || busy) return;
    void syncQueue();
  }, [busy, online, queueCount, syncQueue, workspaceId]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return documents.filter((document) => {
      if (!showArchived && document.status === "archived") return false;
      const linkText = document.links.map((link) => targetLabel(targets, link)).join(" ");
      return !needle || [
        document.name,
        document.original_file_name,
        document.document_type,
        document.category,
        document.description,
        document.status,
        linkText,
      ].join(" ").toLowerCase().includes(needle);
    });
  }, [documents, query, showArchived, targets]);

  function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > MAX_FILE_SIZE) {
      setError("Choose a file no larger than 10 MB.");
      return;
    }
    setError("");
    setSelectedFile(file);
    setUploadForm({
      name: file.name,
      category: "general",
      description: "",
      linkType: "business",
      targetId: "",
    });
    setUploadOpen(true);
  }

  async function submitUpload(event: FormEvent) {
    event.preventDefault();
    if (!selectedFile || !workspaceId || busy || supportReadOnly) return;
    if (uploadForm.linkType !== "business" && !uploadForm.targetId) {
      setError("Choose the exact record this Document belongs to.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await enqueueGeneralDocumentUpload(
        workspaceId,
        crypto.randomUUID(),
        selectedFile,
        {
          linkId: crypto.randomUUID(),
          name: uploadForm.name.trim(),
          category: uploadForm.category,
          description: uploadForm.description.trim(),
          linkType: uploadForm.linkType,
          targetId: uploadForm.linkType === "business" ? null : uploadForm.targetId,
          uploadedAt: new Date().toISOString(),
        },
      );
      await refreshQueue(workspaceId);
      setUploadOpen(false);
      setSelectedFile(null);
      if (!online) {
        setNotice("Saved offline. The file will upload in order when the connection returns.");
      }
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "The Document could not be queued.");
    } finally {
      setBusy(false);
    }
    if (online) await syncQueue();
  }

  async function queueAction(
    document: GeneralDocument,
    action: "add_link" | "revoke_link" | "archive_document",
    payload: Record<string, unknown>,
  ) {
    if (!workspaceId || busy || supportReadOnly) return;
    setBusy(true);
    setError("");
    try {
      await enqueueGeneralDocumentAction(workspaceId, document.id, action, payload);
      await refreshQueue(workspaceId);
      if (!online) setNotice("Saved offline. BDB OS will replay this Document command after reconnection.");
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "The Document command could not be queued.");
    } finally {
      setBusy(false);
    }
    if (online) await syncQueue();
  }

  async function addLink(event: FormEvent) {
    event.preventDefault();
    if (!managing || (newLinkType !== "business" && !newTargetId)) return;
    await queueAction(managing, "add_link", {
      linkId: crypto.randomUUID(),
      linkType: newLinkType,
      targetId: newLinkType === "business" ? null : newTargetId,
      occurredAt: new Date().toISOString(),
    });
    setNewTargetId("");
    setManaging(null);
  }

  async function revokeLink(link: DocumentLink) {
    if (!managing || revokeReason.trim().length < 5) {
      setError("Enter a revoke reason of at least five characters.");
      return;
    }
    await queueAction(managing, "revoke_link", {
      linkId: link.id,
      reason: revokeReason.trim(),
      occurredAt: new Date().toISOString(),
    });
    setRevokeReason("");
    setManaging(null);
  }

  async function archiveDocument(event: FormEvent) {
    event.preventDefault();
    if (!managing || archiveReason.trim().length < 5) return;
    await queueAction(managing, "archive_document", {
      reason: archiveReason.trim(),
      occurredAt: new Date().toISOString(),
    });
    setArchiveReason("");
    setManaging(null);
  }

  const activeCount = documents.filter((document) => document.status === "active").length;
  const linkedCount = documents.filter((document) => document.links.some((link) => link.type !== "business")).length;
  const imageCount = documents.filter((document) => document.document_type === "Image").length;

  return (
    <>
      <PageHeader
        eyebrow="Authoritative files"
        title="General Documents"
        description="One controlled Document record, connected to the exact Customers, Appointments, Sales, Invoices, Payments and Communications it supports."
        action={
          <Button disabled={supportReadOnly || busy || !access.documents} onClick={() => inputRef.current?.click()}>
            <UploadCloud size={17} /> Upload file
          </Button>
        }
      />
      <input
        ref={inputRef}
        type="file"
        hidden
        onChange={chooseFile}
        accept=".pdf,.png,.jpg,.jpeg,.doc,.docx,.xls,.xlsx"
      />

      {!online ? <div className="review-callout"><WifiOff size={19} /><div><strong>Offline Document mode</strong><p>Cached files remain visible. New commands are queued and replayed in order.</p></div></div> : null}
      {supportReadOnly ? <div className="review-callout"><AlertCircle size={19} /><div><strong>Read-only access</strong><p>Use an account with document permissions to upload, link or archive Documents.</p></div></div> : null}
      {notice ? <div className="review-callout"><RefreshCw size={19} /><div><strong>Documents status</strong><p>{notice}</p></div></div> : null}
      {error ? <div className="review-callout"><AlertCircle size={19} /><div><strong>Documents needs attention</strong><p>{error}</p></div></div> : null}

      <div className="stat-grid">
        <StatCard label="Active Documents" value={String(activeCount)} detail="Authoritative file records" icon={<Files size={19} />} />
        <StatCard label="Cross-linked" value={String(linkedCount)} detail="Connected beyond Business" icon={<Link2 size={19} />} />
        <StatCard label="Images" value={String(imageCount)} detail="Visual references" icon={<FileImage size={19} />} />
        <StatCard label="Queued" value={String(queueCount)} detail="Ordered offline commands" icon={<ScanText size={19} />} />
      </div>

      <div className="two-column" style={{ marginBottom: 18 }}>
        <div className="upload-zone">
          <UploadCloud size={26} />
          <p>Drop a file here or click to choose</p>
          <small>PDF, image, Word or spreadsheet · maximum 10 MB</small>
          <input type="file" aria-label="Upload document" onChange={chooseFile} accept=".pdf,.png,.jpg,.jpeg,.doc,.docx,.xls,.xlsx" />
        </div>
        <Card className="card-pad">
          <p className="eyebrow">Controlled filing</p>
          <h2>Files stay in Documents</h2>
          <p className="muted small" style={{ marginBottom: 0 }}>Other departments receive typed links. They do not receive copied files or control Document lifecycle.</p>
        </Card>
      </div>

      <div className="toolbar">
        <input className="filter-input" placeholder="Search files, categories or linked records…" value={query} onChange={(event) => setQuery(event.target.value)} />
        <label className="muted small" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input type="checkbox" checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} />
          Show archived
        </label>
        {queueCount > 0 && online ? <Button variant="quiet" disabled={busy} onClick={() => void syncQueue()}><RefreshCw size={16} /> Sync {queueCount}</Button> : null}
        <Badge tone="neutral">{visible.length} files</Badge>
      </div>

      <Card className="table-card">
        <div className="table-scroll">
          <table>
            <thead><tr><th>Document</th><th>Context</th><th>Category</th><th>Uploaded</th><th>Status</th><th /></tr></thead>
            <tbody>{visible.map((document) => (
              <tr key={document.id}>
                <td><div style={{ display: "flex", alignItems: "center", gap: 10 }}><span className="result-icon">{document.document_type === "Image" ? <FileImage size={17} /> : <FileText size={17} />}</span><span className="cell-stack"><strong>{document.name}</strong><span>{document.document_type} · {document.size_label}</span></span></div></td>
                <td><div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{document.links.length ? document.links.map((link) => <Badge key={link.id} tone="blue">{targetLabel(targets, link)}</Badge>) : <Badge tone="neutral">Unlinked</Badge>}</div></td>
                <td>{document.category.replaceAll("_", " ")}</td>
                <td>{formatDate(document.uploaded_at, { day: "numeric", month: "short", year: "numeric" })}</td>
                <td><Badge tone={document.status === "active" ? "green" : "neutral"}>{document.status}</Badge></td>
                <td><Button variant="quiet" disabled={supportReadOnly || busy} onClick={() => { setManaging(document); setNewLinkType("customer"); setNewTargetId(""); setRevokeReason(""); setArchiveReason(""); }}><Settings2 size={16} /> Manage</Button></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
        {loaded && visible.length === 0 ? <div className="card-pad"><h2>No Documents found</h2><p className="muted">{query ? "Try a different search." : "Upload the first file and connect it to its business context."}</p></div> : null}
      </Card>

      <Dialog open={uploadOpen} onClose={() => { if (!busy) setUploadOpen(false); }} title="File this Document" description="The file appears as confirmed only after private storage and the trusted Document command both succeed.">
        <form onSubmit={submitUpload}>
          <div className="form-grid">
            <div className="field field-full"><label htmlFor="document-name">Document name</label><input id="document-name" required maxLength={240} value={uploadForm.name} onChange={(event) => setUploadForm({ ...uploadForm, name: event.target.value })} /></div>
            <div className="field"><label htmlFor="document-category">Category</label><select id="document-category" value={uploadForm.category} onChange={(event) => setUploadForm({ ...uploadForm, category: event.target.value })}><option value="general">General</option><option value="contract">Contract</option><option value="identity">Identity</option><option value="finance">Finance</option><option value="operations">Operations</option><option value="reference">Reference</option></select></div>
            <div className="field"><label htmlFor="document-link-type">Linked department record</label><select id="document-link-type" value={uploadForm.linkType} onChange={(event) => setUploadForm({ ...uploadForm, linkType: event.target.value as LinkType, targetId: "" })}>{LINK_TYPES.map(([value, label]) => <option key={value} value={value} disabled={value !== "business" && targets[value].length === 0}>{label}</option>)}</select></div>
            {uploadForm.linkType !== "business" ? <div className="field field-full"><label htmlFor="document-target">Exact record</label><select id="document-target" required value={uploadForm.targetId} onChange={(event) => setUploadForm({ ...uploadForm, targetId: event.target.value })}><option value="">Choose a {linkTypeLabel(uploadForm.linkType).toLowerCase()}</option>{targets[uploadForm.linkType].map((target) => <option key={String(target.id)} value={String(target.id)}>{target.label} — {target.detail}</option>)}</select></div> : null}
            <div className="field field-full"><label htmlFor="document-description">Description</label><textarea id="document-description" maxLength={2000} value={uploadForm.description} onChange={(event) => setUploadForm({ ...uploadForm, description: event.target.value })} /></div>
          </div>
          <div className="dialog-actions"><Button type="button" variant="quiet" disabled={busy} onClick={() => setUploadOpen(false)}>Cancel</Button><Button type="submit" disabled={busy || !selectedFile}>{online ? "Upload Document" : "Save offline"}</Button></div>
        </form>
      </Dialog>

      <Dialog open={Boolean(managing)} onClose={() => { if (!busy) setManaging(null); }} title={managing ? `Manage ${managing.name}` : "Manage Document"} description="Add or revoke typed links without changing the source department record. Archive preserves the Document history.">
        {managing ? <div>
          <p className="eyebrow">Active links</p>
          <div style={{ display: "grid", gap: 10, marginBottom: 18 }}>
            {managing.links.map((link) => <Card key={link.id} className="card-pad"><div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}><div><strong>{targetLabel(targets, link)}</strong><p className="muted small" style={{ margin: "4px 0 0" }}>{linkTypeLabel(link.type)}</p></div><Button type="button" variant="quiet" disabled={busy || revokeReason.trim().length < 5} onClick={() => void revokeLink(link)}><XCircle size={16} /> Revoke</Button></div></Card>)}
            {managing.links.length === 0 ? <p className="muted">No active links.</p> : null}
          </div>
          <div className="field field-full" style={{ marginBottom: 18 }}><label htmlFor="document-revoke-reason">Reason used when revoking a link</label><input id="document-revoke-reason" minLength={5} maxLength={500} value={revokeReason} onChange={(event) => setRevokeReason(event.target.value)} placeholder="Why is this link no longer correct?" /></div>

          {managing.status === "active" ? <form onSubmit={addLink} style={{ marginBottom: 22 }}>
            <p className="eyebrow">Add another context</p>
            <div className="form-grid">
              <div className="field"><label htmlFor="new-document-link-type">Record type</label><select id="new-document-link-type" value={newLinkType} onChange={(event) => { setNewLinkType(event.target.value as LinkType); setNewTargetId(""); }}>{LINK_TYPES.map(([value, label]) => <option key={value} value={value} disabled={value !== "business" && targets[value].length === 0}>{label}</option>)}</select></div>
              {newLinkType !== "business" ? <div className="field"><label htmlFor="new-document-target">Exact record</label><select id="new-document-target" required value={newTargetId} onChange={(event) => setNewTargetId(event.target.value)}><option value="">Choose record</option>{targets[newLinkType].map((target) => <option key={String(target.id)} value={String(target.id)}>{target.label} — {target.detail}</option>)}</select></div> : null}
            </div>
            <div className="dialog-actions"><Button type="submit" disabled={busy || (newLinkType !== "business" && !newTargetId)}><Link2 size={16} /> Add link</Button></div>
          </form> : null}

          {managing.status === "active" ? <form onSubmit={archiveDocument}>
            <p className="eyebrow">Archive Document</p>
            <div className="field field-full"><label htmlFor="document-archive-reason">Archive reason</label><input id="document-archive-reason" required minLength={5} maxLength={500} value={archiveReason} onChange={(event) => setArchiveReason(event.target.value)} /></div>
            <div className="dialog-actions"><Button type="submit" variant="quiet" disabled={busy || archiveReason.trim().length < 5}><Archive size={16} /> Archive</Button></div>
          </form> : <Badge tone="neutral">Archived {managing.archived_at ? formatDate(managing.archived_at) : ""}</Badge>}
        </div> : null}
      </Dialog>
    </>
  );
}
