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
          <p>Invoices, Credit Notes and Delivery Notes each have their own bounded register while sharing the same validated document engine underneath.</p>
        </div>
        <div className={styles.heroActions}>
          <Link className={styles.primaryLink} href="/accounts/operations"><Plus size={16} /> New document</Link>
        </div>
      </section>

      <section className={styles.salesGrid}>
        <article className={styles.card}>
          <span className={styles.cardIcon}><FileText size={19} /></span>
          <h3>Invoices</h3>
          <p>Database-side search, filters and cursor pagination. Full lines, linked credits, Payments, Delivery Notes and notes load only when one Invoice is opened.</p>
          <div className={styles.cardFooter}><Link className={styles.quietLink} href="/accounts/sales/invoices">Open Invoice register <ArrowRight size={15} /></Link></div>
        </article>
        <article className={styles.card}>
          <span className={styles.cardIcon}><FileMinus2 size={19} /></span>
          <h3>Credit Notes</h3>
          <p>Quantity-backed reversals stay connected to the original Invoice and now browse independently in bounded pages.</p>
          <div className={styles.cardFooter}><Link className={styles.quietLink} href="/accounts/sales/credit-notes">Open Credit Notes <ArrowRight size={15} /></Link></div>
        </article>
        <article className={styles.card}>
          <span className={styles.cardIcon}><PackageCheck size={19} /></span>
          <h3>Delivery Notes</h3>
          <p>Fulfilment documents remain separate from financial balances and now have their own scalable register.</p>
          <div className={styles.cardFooter}><Link className={styles.quietLink} href="/accounts/sales/delivery-notes">Open Delivery Notes <ArrowRight size={15} /></Link></div>
        </article>
        <article className={styles.card}>
          <span className={styles.cardIcon}><Plus size={19} /></span>
          <h3>Document workbench</h3>
          <p>The validated creation and correction commands remain here during the workspace split so navigation changes do not duplicate financial write logic.</p>
          <div className={styles.cardFooter}><Link className={styles.quietLink} href="/accounts/operations">Create / correct documents <ArrowRight size={15} /></Link></div>
        </article>
      </section>
    </main>
  );
}
