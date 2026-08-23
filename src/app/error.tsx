"use client";

import { useEffect } from "react";
import Link from "next/link";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="mfa-shell">
      <section className="mfa-card">
        <p className="marketing-kicker">Something went wrong</p>
        <h1>We couldn’t load this page.</h1>
        <p>Your data has not been changed. Try the page again, or return to your workspace.</p>
        <div className="marketing-actions">
          <button className="button button-primary" type="button" onClick={reset}>Try again</button>
          <Link className="button button-secondary" href="/workspace">Return to workspace</Link>
        </div>
      </section>
    </main>
  );
}
