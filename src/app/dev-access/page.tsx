import { BdbMonogram } from "@/components/brand";
import { DevRoleSwitcher } from "@/components/dev-role-switcher";

export default function DevelopmentAccessPage() {
  return (
    <main className="admin-loading" style={{ minHeight: "100vh", flexDirection: "column", gap: 18, padding: 24, textAlign: "center" }}>
      <BdbMonogram />
      <div style={{ maxWidth: 620 }}>
        <p className="eyebrow">Protected preview</p>
        <h1 style={{ margin: "8px 0 10px" }}>Development access</h1>
        <p className="muted">
          Open the platform control plane or the seeded client workspace without using the normal production login flow.
        </p>
      </div>
      <DevRoleSwitcher expanded />
      <p className="muted" style={{ maxWidth: 620, fontSize: ".82rem" }}>
        This page is available only on the approved integration preview and approved development Supabase project.
      </p>
    </main>
  );
}
