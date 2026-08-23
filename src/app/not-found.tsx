import Link from "next/link";
import { BdbMonogram } from "@/components/brand";

export default function NotFound() {
  return (
    <main className="mfa-shell">
      <BdbMonogram />
      <section className="mfa-card">
        <p className="marketing-kicker">404 · Page not found</p>
        <h1>This page isn’t here.</h1>
        <p>The address may have changed, or the page may no longer be available.</p>
        <Link className="button button-primary" href="/">Back to BDB OS</Link>
      </section>
    </main>
  );
}
