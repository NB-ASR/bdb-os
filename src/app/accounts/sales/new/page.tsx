import Link from "next/link";
import { ArrowLeft, ArrowRight, FileMinus2, FileText, PackageCheck } from "lucide-react";
import styles from "@/components/accounts/accounts-composer.module.css";

const choices = [
  {
    href: "/accounts/sales/invoices/new",
    title: "Invoice",
    description: "Issue an official Invoice from catalogue Products and Services. Catalogue price and VAT remain authoritative.",
    icon: FileText,
  },
  {
    href: "/accounts/sales/credit-notes/new",
    title: "Credit Note",
    description: "Cancel an Invoice or reverse genuine quantities using the original Invoice line values.",
    icon: FileMinus2,
  },
  {
    href: "/accounts/sales/delivery-notes/new",
    title: "Delivery Note",
    description: "Record a standalone delivery or link fulfilment to an issued Invoice or completed Sale.",
    icon: PackageCheck,
  },
] as const;

export default function NewAccountsDocumentPage() {
  return (
    <main className={styles.workspace}>
      <header className={styles.header}>
        <div className={styles.heading}>
          <p className={styles.eyebrow}>Accounts · Sales</p>
          <h1>New document</h1>
          <p>Choose the record that reflects what happened. Each flow uses the same authoritative numbering, command queue and immutable document engine.</p>
        </div>
        <Link className={styles.backLink} href="/accounts/sales"><ArrowLeft size={15} /> Sales</Link>
      </header>

      <section className={styles.documentChoiceGrid} aria-label="Document type">
        {choices.map((choice) => {
          const Icon = choice.icon;
          return (
            <Link className={styles.documentChoice} href={choice.href} key={choice.href}>
              <Icon size={24} />
              <h2>{choice.title}</h2>
              <p>{choice.description}</p>
              <span>Continue <ArrowRight size={14} /></span>
            </Link>
          );
        })}
      </section>
    </main>
  );
}
