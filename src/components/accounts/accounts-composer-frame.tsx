"use client";

import Link from "next/link";
import { ArrowLeft, RefreshCw, TriangleAlert, WifiOff, X } from "lucide-react";
import type { ReactNode } from "react";
import styles from "./accounts-composer.module.css";

export function AccountsComposerFrame({
  eyebrow,
  title,
  description,
  backHref,
  backLabel,
  online,
  pendingCount,
  loading,
  error,
  notice,
  onDismissError,
  onDismissNotice,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  backHref: string;
  backLabel: string;
  online: boolean;
  pendingCount: number;
  loading: boolean;
  error: string;
  notice: string;
  onDismissError: () => void;
  onDismissNotice: () => void;
  children: ReactNode;
}) {
  return (
    <main className={styles.workspace}>
      <header className={styles.header}>
        <div className={styles.heading}>
          <p className={styles.eyebrow}>{eyebrow}</p>
          <h1>{title}</h1>
          <p>{description}</p>
        </div>
        <Link className={styles.backLink} href={backHref}><ArrowLeft size={15} /> {backLabel}</Link>
      </header>

      {!online ? <div className={styles.notice}><WifiOff size={17} /><div><strong>Offline</strong><span>Financial commands can remain Pending sync and will replay in order after reconnection.</span></div></div> : null}
      {pendingCount ? <div className={styles.notice}><RefreshCw size={17} /><div><strong>{pendingCount} Accounts change{pendingCount === 1 ? "" : "s"} Pending sync</strong><span>Permanent numbers are assigned safely and idempotently by the authoritative command engine.</span></div></div> : null}
      {error ? <div className={styles.notice} data-tone="error"><TriangleAlert size={17} /><div><strong>Accounts needs attention</strong><span>{error}</span></div><button type="button" aria-label="Dismiss error" onClick={onDismissError}><X size={14} /></button></div> : null}
      {notice ? <div className={styles.notice}><RefreshCw size={17} /><div><strong>{loading ? "Opening Accounts" : "Accounts update"}</strong><span>{notice}</span></div><button type="button" aria-label="Dismiss notice" onClick={onDismissNotice}><X size={14} /></button></div> : null}
      {children}
    </main>
  );
}
