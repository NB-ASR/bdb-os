"use client";

export default function GlobalError({ reset }: { reset: () => void }) {
  return (
    <html lang="en">
      <body>
        <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24, background: "#10100f", color: "#f4f1e8", fontFamily: "sans-serif" }}>
          <section style={{ width: "min(100%, 480px)", padding: 32, border: "1px solid #4a4030", borderRadius: 18, background: "#171613" }}>
            <p style={{ color: "#d3a84b", fontWeight: 700 }}>BDB OS</p>
            <h1>We couldn’t load the application.</h1>
            <p style={{ color: "#c5bfb2", lineHeight: 1.6 }}>Your data has not been changed. Please try again.</p>
            <button style={{ minHeight: 42, padding: "0 16px", border: 0, borderRadius: 10, background: "#d3a84b", color: "#17140d", fontWeight: 700, cursor: "pointer" }} type="button" onClick={reset}>Try again</button>
          </section>
        </main>
      </body>
    </html>
  );
}
