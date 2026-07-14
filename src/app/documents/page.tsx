"use client";

import { useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { Download, FileImage, Files, FileText, ScanText, UploadCloud } from "lucide-react";
import { useBdb } from "@/lib/store";
import { useSaas } from "@/lib/saas/context";
import { createClient } from "@/lib/supabase/client";
import { formatDate } from "@/lib/format";
import { Badge, Button, Card, Dialog, PageHeader, StatCard } from "@/components/ui";

function fileSize(bytes: number) {
  return bytes > 1_000_000 ? `${(bytes / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1_000))} KB`;
}

export default function DocumentsPage() {
  const { state, addDocument } = useBdb();
  const { mode, workspace } = useSaas();
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [form, setForm] = useState({ name: "", type: "PDF", size: "", customerId: "", linkedTo: "Business" });

  const visible = state.documents.filter((item) => [item.name, item.type, item.linkedTo].join(" ").toLowerCase().includes(query.toLowerCase()));

  function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) {
      setError("Files must be 20 MB or smaller.");
      return;
    }
    setError("");
    setSelectedFile(file);
    setForm({ name: file.name, type: file.type.includes("image") ? "Image" : file.name.split(".").at(-1)?.toUpperCase() || "File", size: fileSize(file.size), customerId: "", linkedTo: "Business" });
    setOpen(true);
    event.target.value = "";
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setUploading(true);
    setError("");
    let storagePath: string | undefined;
    if (mode === "live") {
      if (!selectedFile || !workspace) {
        setError("Choose a file and wait for the workspace to finish loading.");
        setUploading(false);
        return;
      }
      const safeName = selectedFile.name.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(-120);
      storagePath = `${workspace.id}/${crypto.randomUUID()}-${safeName}`;
      const supabase = createClient();
      const { error: uploadError } = await supabase!.storage.from("workspace-documents").upload(storagePath, selectedFile, { upsert: false, cacheControl: "3600" });
      if (uploadError) {
        setError(uploadError.message);
        setUploading(false);
        return;
      }
    }
    addDocument({ ...form, customerId: form.customerId || undefined, storagePath });
    setOpen(false);
    setSelectedFile(null);
    setUploading(false);
  }

  async function download(path: string) {
    const supabase = createClient();
    if (!supabase) return;
    const { data, error: signedError } = await supabase.storage.from("workspace-documents").createSignedUrl(path, 60);
    if (signedError) {
      setError(signedError.message);
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  }

  return (
    <>
      <PageHeader eyebrow="Connected files" title="Documents" description="Business files organised around the customers, invoices and bookings they belong to." action={<Button onClick={() => inputRef.current?.click()}><UploadCloud size={17} /> Upload file</Button>} />
      <input ref={inputRef} type="file" hidden onChange={chooseFile} accept=".pdf,.png,.jpg,.jpeg,.doc,.docx,.xls,.xlsx" />
      <div className="stat-grid">
        <StatCard label="Documents" value={String(state.documents.length)} detail="In your library" icon={<Files size={19} />} />
        <StatCard label="PDF files" value={String(state.documents.filter((item) => item.type === "PDF").length)} detail="Ready to search" icon={<FileText size={19} />} />
        <StatCard label="Images" value={String(state.documents.filter((item) => item.type === "Image").length)} detail="Visual references" icon={<FileImage size={19} />} />
        <StatCard label="AI scanned" value={String(Math.max(0, state.documents.length - 1))} detail="Suggested connections" icon={<ScanText size={19} />} />
      </div>

      <div className="two-column" style={{ marginBottom: 18 }}>
        <div className="upload-zone">
          <UploadCloud size={26} />
          <p>Drop a file here or click to choose</p>
          <small>PDF, image, Word or spreadsheet · private files up to 20 MB</small>
          <input type="file" aria-label="Upload document" onChange={chooseFile} accept=".pdf,.png,.jpg,.jpeg,.doc,.docx,.xls,.xlsx" />
        </div>
        <Card className="card-pad"><p className="eyebrow">Smart filing</p><h2>Every file finds its context</h2><p className="muted small" style={{ marginBottom: 0 }}>BDB suggests a customer and linked record after upload. You approve the final filing location.</p></Card>
      </div>

      <div className="toolbar"><input className="filter-input" placeholder="Search documents or linked records…" value={query} onChange={(event) => setQuery(event.target.value)} /><Badge tone="neutral">{visible.length} files</Badge></div>
      {error && !open ? <p className="form-error" style={{ marginBottom: 14 }}>{error}</p> : null}
      <Card className="table-card"><div className="table-scroll"><table><thead><tr><th>Document</th><th>Linked record</th><th>Customer</th><th>Uploaded</th><th>Size</th><th aria-label="Download" /></tr></thead><tbody>{visible.map((document) => {
        const customer = state.customers.find((item) => item.id === document.customerId);
        return <tr key={document.id}><td><div style={{ display: "flex", alignItems: "center", gap: 10 }}><span className="result-icon">{document.type === "Image" ? <FileImage size={17} /> : <FileText size={17} />}</span><span className="cell-stack"><strong>{document.name}</strong><span>{document.type}</span></span></div></td><td><Badge tone="blue">{document.linkedTo}</Badge></td><td>{customer?.name ?? <span className="muted">Business</span>}</td><td>{formatDate(document.uploadedAt, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</td><td className="muted">{document.size}</td><td className="align-right">{document.storagePath ? <button className="icon-button document-download" onClick={() => void download(document.storagePath!)} aria-label={`Download ${document.name}`}><Download size={15} /></button> : <span className="muted">—</span>}</td></tr>;
      })}</tbody></table></div></Card>

      <Dialog open={open} onClose={() => setOpen(false)} title="File this document" description="BDB suggests context; you approve where the file belongs.">
        <form onSubmit={submit}>
          <div className="form-grid">
            <div className="field field-full"><label htmlFor="document-name">File name</label><input id="document-name" required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></div>
            <div className="field"><label htmlFor="document-customer">Customer</label><select id="document-customer" value={form.customerId} onChange={(event) => setForm({ ...form, customerId: event.target.value })}><option value="">Business file</option>{state.customers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
            <div className="field"><label htmlFor="document-link">Linked record</label><input id="document-link" required value={form.linkedTo} onChange={(event) => setForm({ ...form, linkedTo: event.target.value })} placeholder="Invoice, booking or business" /></div>
          </div>
          {error ? <p className="form-error" style={{ marginTop: 15 }}>{error}</p> : null}
          <div className="dialog-actions"><Button type="button" variant="quiet" onClick={() => { setOpen(false); setSelectedFile(null); }}>Cancel</Button><Button type="submit" disabled={uploading}>{uploading ? "Uploading securely…" : "Approve upload"}</Button></div>
        </form>
      </Dialog>
    </>
  );
}
