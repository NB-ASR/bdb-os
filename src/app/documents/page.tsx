"use client";

import { useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { AlertCircle, FileImage, Files, FileText, ScanText, UploadCloud } from "lucide-react";
import { useBdb } from "@/lib/store";
import { formatDate } from "@/lib/format";
import { Badge, Button, Card, Dialog, PageHeader, StatCard } from "@/components/ui";

const MAX_FILE_SIZE = 10_000_000;

function fileSize(bytes: number) {
  return bytes > 1_000_000 ? `${(bytes / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1_000))} KB`;
}

export default function DocumentsPage() {
  const { state, addDocument } = useBdb();
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | undefined>();
  const [form, setForm] = useState({ name: "", type: "PDF", size: "", customerId: "", linkedTo: "Business" });
  const visible = state.documents.filter((item) => [item.name, item.type, item.linkedTo].join(" ").toLowerCase().includes(query.toLowerCase()));

  function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > MAX_FILE_SIZE) {
      setFileError("Choose a file smaller than 10 MB.");
      return;
    }
    setFileError(null);
    setSelectedFile(file);
    setForm({ name: file.name, type: file.type.includes("image") ? "Image" : file.name.split(".").at(-1)?.toUpperCase() || "File", size: fileSize(file.size), customerId: "", linkedTo: "Business" });
    setOpen(true);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!selectedFile || uploading) return;
    setUploading(true);
    const confirmed = await addDocument({ ...form, customerId: form.customerId || undefined }, selectedFile);
    setUploading(false);
    if (!confirmed) return;
    setSelectedFile(undefined);
    setForm({ name: "", type: "PDF", size: "", customerId: "", linkedTo: "Business" });
    setOpen(false);
  }

  return (
    <>
      <PageHeader eyebrow="Connected files" title="Documents" description="Business files organised around the customers, invoices and bookings they belong to." action={<Button onClick={() => inputRef.current?.click()}><UploadCloud size={17} /> Upload file</Button>} />
      <input ref={inputRef} type="file" hidden onChange={chooseFile} accept=".pdf,.png,.jpg,.jpeg,.doc,.docx,.xls,.xlsx" />
      {fileError ? <div className="review-callout"><AlertCircle size={19} /><div><strong>File not selected</strong><p>{fileError}</p></div></div> : null}
      <div className="stat-grid">
        <StatCard label="Documents" value={String(state.documents.length)} detail="Confirmed records" icon={<Files size={19} />} />
        <StatCard label="PDF files" value={String(state.documents.filter((item) => item.type === "PDF").length)} detail="Stored documents" icon={<FileText size={19} />} />
        <StatCard label="Images" value={String(state.documents.filter((item) => item.type === "Image").length)} detail="Visual references" icon={<FileImage size={19} />} />
        <StatCard label="AI extracted" value="0" detail="Extraction not enabled" icon={<ScanText size={19} />} />
      </div>

      <div className="two-column" style={{ marginBottom: 18 }}>
        <div className="upload-zone">
          <UploadCloud size={26} />
          <p>Drop a file here or click to choose</p>
          <small>PDF, image, Word or spreadsheet · maximum 10 MB</small>
          <input type="file" aria-label="Upload document" onChange={chooseFile} accept=".pdf,.png,.jpg,.jpeg,.doc,.docx,.xls,.xlsx" />
        </div>
        <Card className="card-pad"><p className="eyebrow">Controlled filing</p><h2>You choose the context</h2><p className="muted small" style={{ marginBottom: 0 }}>Select the customer and linked record before upload. Automatic extraction and filing suggestions are not enabled in this workspace yet.</p></Card>
      </div>

      <div className="toolbar"><input className="filter-input" placeholder="Search documents or linked records…" value={query} onChange={(event) => setQuery(event.target.value)} /><Badge tone="neutral">{visible.length} files</Badge></div>
      <Card className="table-card">
        <div className="table-scroll"><table><thead><tr><th>Document</th><th>Linked record</th><th>Customer</th><th>Uploaded</th><th>Size</th></tr></thead><tbody>{visible.map((document) => {
          const customer = state.customers.find((item) => item.id === document.customerId);
          return <tr key={document.id}><td><div style={{ display: "flex", alignItems: "center", gap: 10 }}><span className="result-icon">{document.type === "Image" ? <FileImage size={17} /> : <FileText size={17} />}</span><span className="cell-stack"><strong>{document.name}</strong><span>{document.type}</span></span></div></td><td><Badge tone="blue">{document.linkedTo}</Badge></td><td>{customer?.name ?? <span className="muted">Business</span>}</td><td>{formatDate(document.uploadedAt, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</td><td className="muted">{document.size}</td></tr>;
        })}</tbody></table></div>
        {visible.length === 0 ? <div className="card-pad"><h2>No documents found</h2><p className="muted">{query ? "Try a different search." : "Upload the first file and choose where it belongs."}</p></div> : null}
      </Card>

      <Dialog open={open} onClose={() => { if (!uploading) setOpen(false); }} title="File this document" description="The file and its metadata appear only after both storage steps succeed.">
        <form onSubmit={submit}>
          <div className="form-grid">
            <div className="field field-full"><label htmlFor="document-name">File name</label><input id="document-name" required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></div>
            <div className="field"><label htmlFor="document-customer">Customer</label><select id="document-customer" value={form.customerId} onChange={(event) => setForm({ ...form, customerId: event.target.value })}><option value="">Business file</option>{state.customers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
            <div className="field"><label htmlFor="document-link">Linked record</label><input id="document-link" required value={form.linkedTo} onChange={(event) => setForm({ ...form, linkedTo: event.target.value })} placeholder="Invoice, booking or business" /></div>
          </div>
          <div className="dialog-actions"><Button type="button" variant="quiet" disabled={uploading} onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" disabled={uploading}>{uploading ? "Uploading…" : "Upload document"}</Button></div>
        </form>
      </Dialog>
    </>
  );
}
