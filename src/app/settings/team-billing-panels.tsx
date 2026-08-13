"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { CreditCard, Loader2, Plus, ShieldCheck } from "lucide-react";
import { Button, Card, SectionHeading } from "@/components/ui";
import styles from "./settings.module.css";

type Member = {
  user_id: string;
  role: string;
  status: string;
  email: string;
  profiles?: { full_name?: string } | null;
};

export function TeamPanel({ mode, canManage }: { mode: "cloud" | "demo"; canManage: boolean }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviting, setInviting] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    if (mode === "demo") {
      setMembers([
        { user_id: "demo-owner", role: "owner", status: "active", email: "owner@business.com", profiles: { full_name: "Workspace Owner" } },
        { user_id: "demo-manager", role: "manager", status: "active", email: "manager@business.com", profiles: { full_name: "Operations Manager" } },
      ]);
      setLoading(false);
      return;
    }
    try {
      const response = await fetch("/api/workspace/team", { cache: "no-store" });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error ?? "The team could not be loaded.");
      setMembers(Array.isArray(result.members) ? result.members : []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "The team could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [mode]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mode === "demo") {
      setError("Connect a cloud workspace to send real invitations.");
      return;
    }
    setInviting(true);
    setError("");
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    try {
      const response = await fetch("/api/workspace/team", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: form.get("email"), role: form.get("role") }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error ?? "The invitation could not be sent.");
      formElement.reset();
      await load();
    } catch (inviteError) {
      setError(inviteError instanceof Error ? inviteError.message : "The invitation could not be sent.");
    } finally {
      setInviting(false);
    }
  }

  return (
    <div className={styles.twoColumn}>
      <Card className="settings-card">
        <SectionHeading title="People & permissions" description="Roles are enforced by database policies, not interface visibility." />
        {error ? <div className="review-callout" role="alert"><ShieldCheck size={18} /><div><strong>Team action blocked</strong><p>{error}</p></div></div> : null}
        {loading ? <Loader2 className="spin" /> : members.length ? (
          <div className="team-list">
            {members.map((member) => (
              <div key={member.user_id}>
                <span className="profile-avatar">{(member.profiles?.full_name || member.email).slice(0, 2).toUpperCase()}</span>
                <span><strong>{member.profiles?.full_name || member.email}</strong><small>{member.email} · {member.status}</small></span>
                <span className={`role-badge ${member.role}`}>{member.role === "staff" ? "Employee" : member.role}</span>
              </div>
            ))}
          </div>
        ) : <p className="muted">No active team members were returned.</p>}
      </Card>
      <Card className="settings-card">
        <SectionHeading title="Invite team member" description="Owners and Managers can add people to this workspace." />
        <form onSubmit={invite}>
          <div className="field"><label>Work email</label><input name="email" type="email" required disabled={!canManage || inviting} /></div>
          <div className="field" style={{ marginTop: 14 }}>
            <label>Role</label>
            <select name="role" disabled={!canManage || inviting}>
              <option value="staff">Employee · daily work</option>
              <option value="manager">Manager · people and settings</option>
              <option value="owner">Owner · full business control</option>
            </select>
          </div>
          <Button type="submit" disabled={!canManage || inviting} style={{ marginTop: 18 }}>
            <Plus size={16} /> {inviting ? "Sending…" : "Send invitation"}
          </Button>
        </form>
      </Card>
    </div>
  );
}

export function BillingPanel({ mode }: { mode: "cloud" | "demo" }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function portal() {
    if (mode === "demo") {
      setError("The billing portal becomes available after a client subscription is connected.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/workspace/billing-portal", { method: "POST" });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || typeof result.url !== "string") {
        throw new Error(result.error ?? "The billing portal is unavailable.");
      }
      window.location.assign(result.url);
    } catch (portalError) {
      setError(portalError instanceof Error ? portalError.message : "The billing portal is unavailable.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={styles.twoColumn}>
      <Card className="settings-card">
        <SectionHeading title="Plan & contract" description="Commercial terms remain linked to the actual workspace agreement." />
        <div className="billing-plan">
          <p className="eyebrow">Workspace agreement</p>
          <h2>{mode === "cloud" ? "Managed by BDB OS" : "Preview workspace"}</h2>
          <p>{mode === "cloud" ? "Use the secure billing portal for verified payment and invoice information." : "No subscription or contract is connected to this browser preview."}</p>
        </div>
      </Card>
      <Card className="settings-note">
        <CreditCard size={22} />
        <h2 style={{ marginTop: 10 }}>Billing support</h2>
        <p>This screen does not invent plan or contract terms when the billing API has not returned them.</p>
        {error ? <p role="alert" style={{ color: "var(--red)", marginTop: 12 }}>{error}</p> : null}
        <Button variant="secondary" style={{ marginTop: 18 }} onClick={() => void portal()} disabled={loading}>
          {loading ? "Opening…" : "Open billing portal"}
        </Button>
      </Card>
    </div>
  );
}
