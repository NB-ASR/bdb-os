import Link from "next/link";
import { ArrowRight, FileMinus2, FileText, PackageCheck, Plus } from "lucide-react";
import styles from "../accounts-workspace.module.css";

export default function AccountsSalesPage() {
  return (
    <main className={styles.workspace}>
      <section className={styles.hero}>
        <div className={styles.heroCopy}>
          <p className={styles.eyebrow}>Accounts · Sales</p>
          <h1>Sales documents</h1>
          <p>Invoices are now treated as a high-volume operational register rather than a list embedded inside one large Accounts page. Credit Notes and Delivery Notes remain connected to the same document engine.</p>
        </div>
        <div className={styles.heroActions}>
          <Link className={styles.primaryLink} href="/accounts/operations"><Plus size={16} /> New document</Link>
        </div>
      </section>

      <section className={styles.salesGrid}>
        <article className={styles.card}>
          <span className={styles.cardIcon}><FileText size={19} /></span>
          <h3>Invoices</h3>
          <p>Dedicated database-side search, filters and cursor pagination. Open one Invoice to load its full lines, linked credits, payments, Delivery Notes and internal history.</p>
          <div className={styles.cardFooter}><Link className={styles.quietLink} href="/accounts/sales/invoices">Open Invoice register <ArrowRight size={15} /></Link></div>
        </article>
        <article className={styles.card}>
          <span className={styles.cardIcon}><FileMinus2 size={19} /></span>
          <h3>Credit Notes</h3>
          <p>Credit Notes remain quantity-backed reversals of issued Invoice snapshots. Their existing creation workflow remains authoritative while the dedicated register is separated from the old mixed page.</p>
          <div className={styles.cardFooter}><Link className={styles.quietLink} href="/accounts/operations">Open Credit Notes <ArrowRight size={15} /></Link></div>
        </article>
        <article className={styles.card}>
          <span className={styles.cardIcon}><PackageCheck size={19} /></span>
          <h3>Delivery Notes</h3>
          <p>Operational fulfilment documents stay separate from accounting balances and can remain standalone or linked to an Invoice/Sale.</p>
          <div className={styles.cardFooter}><Link className={styles.quietLink} href="/accounts/operations">Open Delivery Notes <ArrowRight size={15} /></Link></div>
        </article>
        <article className={styles.card}>
          <span className={styles.cardIcon}><Plus size={19} /></span>
          <h3>Document workbench</h3>
          <p>The validated creation commands are preserved here during the workspace split. This avoids rebuilding financial write logic simply to change navigation.</p>
          <div className={styles.cardFooter}><Link className={styles.quietLink} href="/accounts/operations">Create / correct documents <ArrowRight size={15} /></Link></div>
        </article>
      </section>
    </main>
  );
}
