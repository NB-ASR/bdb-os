import type { Metadata } from "next";
import Link from "next/link";
import { Check, Layers3, ShieldCheck, Sparkles } from "lucide-react";
import { BdbMonogram } from "@/components/brand";
import styles from "../admin/sector-packs/sector-packs.module.css";

export const metadata: Metadata = {
  title: "Sector Packs Preview",
  description: "No-index founder review environment for BDB OS Sector Packs.",
  robots: { index: false, follow: false },
};

const packs = [
  { sector: "General", name: "General Services", copy: "Balanced operating model for service businesses.", labels: ["Customers", "Appointments", "Invoices", "Documents"] },
  { sector: "Healthcare", name: "Healthcare Practice", copy: "Patient-centred consultations, consent and confidential records.", labels: ["Patients", "Consultations", "Invoices", "Clinical documents"] },
  { sector: "Wellness", name: "Wellness Studio", copy: "Booking-led sessions, rebooking and client preferences.", labels: ["Clients", "Sessions", "Invoices", "Client documents"] },
  { sector: "Legal", name: "Legal Practice", copy: "Matter-centred deadlines, checks and fee management.", labels: ["Clients & matters", "Meetings & deadlines", "Fee notes", "Matter documents"] },
  { sector: "Accounting", name: "Accounting Firm", copy: "Deadline and document-led client operations.", labels: ["Clients", "Deadlines & reviews", "Invoices", "Financial documents"] },
];

const healthcareNavigation = [
  "Overview",
  "Accounts",
  "Patients",
  "Consultations",
  "Patient communications",
  "Clinical documents",
  "Reports",
  "Automation",
];

export default function SectorPacksPreviewPage() {
  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <header className={styles.header}>
          <div>
            <BdbMonogram />
            <p className="eyebrow" style={{ marginTop: 18 }}>Founder review · isolated preview</p>
            <h1>One operating system. Purpose-built for each client.</h1>
            <p>Sector Packs combine reusable industry defaults with client-specific vocabulary, workflow and workspace overrides. This page is fictional and cannot save or publish configuration.</p>
          </div>
          <div className={styles.actions}>
            <Link className="button button-secondary" href="/">Return to BDB OS</Link>
            <span className="button button-primary"><Sparkles size={16} /> Preview only</span>
          </div>
        </header>

        <div className={styles.notice}><strong>Architecture boundary</strong><div>Templates configure the shared BDB OS core. They do not create separate sector applications, databases or permission systems.</div></div>

        <div className={styles.grid}>
          <section className={styles.panel}>
            <div className={styles.panelHeader}><h2>Sector library</h2><p>Launch templates available to Founder Admin.</p></div>
            <div className={styles.clientList}>
              {packs.map((pack, index) => (
                <div key={pack.name} className={`${styles.clientButton} ${index === 1 ? styles.clientButtonActive : ""}`}>
                  <span className={styles.initial}>{pack.sector.slice(0, 2).toUpperCase()}</span>
                  <span><strong>{pack.name}</strong><small>{pack.sector} · version 1</small></span>
                </div>
              ))}
            </div>
          </section>

          <section className={styles.panel}>
            <div className={styles.panelHeader}><h2>Harbour Health Clinic</h2><p>Healthcare template with client-specific operating choices.</p></div>
            <div className={styles.editor}>
              <section className={styles.section}>
                <div className={styles.sectionHead}><div><h3>Starting template</h3><p>Healthcare Practice · v1</p></div></div>
                <div className={styles.field}><label>Sector Pack</label><select defaultValue="healthcare" disabled><option value="healthcare">Healthcare · Healthcare Practice · v1</option></select></div>
              </section>

              <section className={styles.section}>
                <div className={styles.sectionHead}><div><h3>Client vocabulary</h3><p>Same records, language appropriate to the practice.</p></div></div>
                <div className={styles.fieldGrid}>
                  {[["Customer singular", "Patient"], ["Customer plural", "Patients"], ["Appointment singular", "Consultation"], ["Appointment plural", "Consultations"], ["Document singular", "Clinical document"], ["Document plural", "Clinical documents"]].map(([label, value]) => <div className={styles.field} key={label}><label>{label}</label><input value={value} readOnly /></div>)}
                </div>
              </section>

              <section className={styles.section}>
                <div className={styles.sectionHead}><div><h3>Operating workflows</h3><p>Approved catalogue before provider configuration.</p></div></div>
                <div className={styles.options}>
                  {["Appointment reminders", "Missed appointment follow-up", "Patient onboarding", "Missing document follow-up"].map((item) => <div className={`${styles.option} ${styles.optionActive}`} key={item}><span className={styles.check}><Check size={14} /></span><span><strong>{item}</strong><small>Included in client blueprint</small></span></div>)}
                </div>
              </section>

              <section className={styles.section}>
                <div className={styles.sectionHead}><div><h3>Compliance prompts</h3><p>Operational gates, never professional advice.</p></div></div>
                <div className={styles.options}>
                  {["Consent recording", "Confidential notes", "Identity verification", "Professional review gate"].map((item) => <div className={`${styles.option} ${styles.optionActive}`} key={item}><span className={styles.check}><Check size={14} /></span><span><strong>{item}</strong><small>Prompt included</small></span></div>)}
                </div>
              </section>
            </div>
          </section>

          <aside className={`${styles.panel} ${styles.preview}`}>
            <div className={styles.panelHeader}><h3>Published blueprint</h3><p>How the client workspace resolves after publication.</p></div>
            <div className={styles.previewBody}>
              <div className={styles.statusRow}><span className={`${styles.status} ${styles.statusPublished}`}><ShieldCheck size={14} /> Published</span><span className={styles.status}>v1</span></div>
              <div><p className="eyebrow">Healthcare</p><h2 style={{ margin: "5px 0" }}>Healthcare Practice</h2><p className="muted small">Patient-centred configuration for independent clinics and allied healthcare practices.</p></div>
              <div className={styles.mockNav}><p>Client navigation</p>{healthcareNavigation.map((item, index) => <span key={item} data-emphasis={index === 2 || index === 3 || index === 4}>{item}</span>)}</div>
              <div><h3 style={{ marginBottom: 10 }}>Vocabulary</h3><div className={styles.list}>{packs[1].labels.map((item) => <div className={styles.listItem} key={item}>{item}</div>)}</div></div>
              <p className={styles.footerNote}><Layers3 size={15} style={{ verticalAlign: "text-bottom", marginRight: 6 }} />The previous published blueprint remains active until a founder explicitly publishes the next draft.</p>
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
}
