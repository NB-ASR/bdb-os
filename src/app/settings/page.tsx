"use client";

import { useState, type FormEvent } from "react";
import { CheckCircle2, DatabaseBackup, RotateCcw, Save, ShieldCheck } from "lucide-react";
import { useBdb } from "@/lib/store";
import { Button, Card, PageHeader, SectionHeading } from "@/components/ui";
import type { BusinessSettings } from "@/lib/types";

export default function SettingsPage() {
  const { state, ready, updateSettings, resetDemo } = useBdb();

  if (!ready) return null;

  return <SettingsForm key={JSON.stringify(state.settings)} initial={state.settings} updateSettings={updateSettings} resetDemo={resetDemo} />;
}

function SettingsForm({ initial, updateSettings, resetDemo }: {
  initial: BusinessSettings;
  updateSettings: (settings: BusinessSettings) => void;
  resetDemo: () => void;
}) {
  const [form, setForm] = useState<BusinessSettings>(initial);
  const [saved, setSaved] = useState(false);

  function submit(event: FormEvent) {
    event.preventDefault();
    updateSettings(form);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2200);
  }

  return (
    <>
      <PageHeader eyebrow="Workspace preferences" title="Settings" description="Make BDB reflect the way your business actually works." />
      <div className="settings-layout">
        <Card className="settings-card">
          <SectionHeading title="Business profile" description="Used across invoices, messages and reports." />
          <form onSubmit={submit}>
            <div className="form-grid">
              <div className="field"><label htmlFor="business-name">Business name</label><input id="business-name" required value={form.businessName} onChange={(event) => setForm({ ...form, businessName: event.target.value })} /></div>
              <div className="field"><label htmlFor="owner-name">Owner name</label><input id="owner-name" required value={form.ownerName} onChange={(event) => setForm({ ...form, ownerName: event.target.value })} /></div>
              <div className="field"><label htmlFor="business-email">Business email</label><input id="business-email" required type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></div>
              <div className="field"><label htmlFor="business-phone">Phone</label><input id="business-phone" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} /></div>
              <div className="field"><label htmlFor="currency">Currency</label><select id="currency" value={form.currency} onChange={(event) => setForm({ ...form, currency: event.target.value as BusinessSettings["currency"] })}><option value="GBP">GBP · British pound</option><option value="EUR">EUR · Euro</option><option value="USD">USD · US dollar</option></select></div>
              <div className="field"><label htmlFor="invoice-prefix">Invoice prefix</label><input id="invoice-prefix" required maxLength={8} value={form.invoicePrefix} onChange={(event) => setForm({ ...form, invoicePrefix: event.target.value.toUpperCase() })} /></div>
              <div className="field"><label htmlFor="vat-rate">VAT rate (%)</label><input id="vat-rate" min="0" max="100" type="number" value={form.vatRate} onChange={(event) => setForm({ ...form, vatRate: Number(event.target.value) })} /></div>
            </div>
            <div className="dialog-actions"><Button type="submit"><Save size={16} /> Save settings</Button></div>
          </form>
        </Card>
        <div>
          <Card className="settings-note"><ShieldCheck size={22} /><h2 style={{ marginTop: 10 }}>Private by design</h2><p>This MVP stores business data in this browser. It does not send customer or financial records to a server.</p></Card>
          <Card className="settings-note" style={{ marginTop: 14 }}><DatabaseBackup size={22} /><h2 style={{ marginTop: 10 }}>Offline continuity</h2><p>Core records remain available after the app has been visited, even if the connection drops.</p><div className="danger-zone"><h3>Reset sample workspace</h3><p>Restore the original demonstration data and remove local changes.</p><Button variant="danger" onClick={() => { if (window.confirm("Reset all local BDB OS demo data?")) resetDemo(); }}><RotateCcw size={15} /> Reset demo data</Button></div></Card>
        </div>
      </div>
      {saved ? <div className="toast"><CheckCircle2 size={17} /> Settings saved locally</div> : null}
    </>
  );
}
