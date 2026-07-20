"use client";

import Image from "next/image";
import { FormEvent, useCallback, useEffect, useState } from "react";
import {
  Accessibility,
  Check,
  CheckCircle2,
  CreditCard,
  ImageUp,
  Loader2,
  Palette,
  Plus,
  Save,
  Settings2,
  ShieldCheck,
  UsersRound,
} from "lucide-react";
import { useBdb } from "@/lib/store";
import { Button, Card, PageHeader, SectionHeading } from "@/components/ui";
import type { BusinessSettings, WorkspaceTheme } from "@/lib/types";

type Tab = "business" | "appearance" | "team" | "billing";
type Member = {
  user_id: string;
  role: string;
  status: string;
  email: string;
  profiles?: { full_name?: string } | null;
};
const presets: Array<{
  id: WorkspaceTheme["preset"];
  name: string;
  colours: string[];
}> = [
  {
    id: "obsidian-gold",
    name: "Obsidian Gold",
    colours: ["#10100f", "#d3a84b"],
  },
  { id: "ocean", name: "Coastal Blue", colours: ["#112027", "#55a7c9"] },
  { id: "forest", name: "Evergreen", colours: ["#111d17", "#65a779"] },
  { id: "clay", name: "Warm Clay", colours: ["#201613", "#c47f62"] },
  { id: "slate", name: "Modern Slate", colours: ["#151820", "#8897ad"] },
  { id: "custom", name: "Custom", colours: ["#171715", "#d3a84b"] },
];

export default function SettingsPage() {
  const { state, ready, mode, role, updateSettings, updateTheme, uploadLogo } =
    useBdb();
  const [tab, setTab] = useState<Tab>("business");
  const canManage = ["owner", "admin", "manager"].includes(role);
  if (!ready) return null;
  return (
    <>
      <PageHeader
        eyebrow="Workspace control"
        title="Settings"
        description="Manage the business profile, team, billing and a workspace identity that feels like your own."
      />
      <div className="settings-tabs">
        <button
          className={tab === "business" ? "active" : ""}
          onClick={() => setTab("business")}
        >
          <Settings2 size={16} /> Business
        </button>
        <button
          className={tab === "appearance" ? "active" : ""}
          onClick={() => setTab("appearance")}
        >
          <Palette size={16} /> Appearance
        </button>
        <button
          className={tab === "team" ? "active" : ""}
          onClick={() => setTab("team")}
        >
          <UsersRound size={16} /> Team & roles
        </button>
        <button
          className={tab === "billing" ? "active" : ""}
          onClick={() => setTab("billing")}
        >
          <CreditCard size={16} /> Plan & billing
        </button>
      </div>
      {tab === "business" && (
        <BusinessForm
          initial={state.settings}
          updateSettings={updateSettings}
          mode={mode}
        />
      )}
      {tab === "appearance" && (
        <AppearanceForm
          initial={state.theme}
          updateTheme={updateTheme}
          uploadLogo={uploadLogo}
          canManage={canManage}
        />
      )}
      {tab === "team" && <TeamPanel mode={mode} canManage={canManage} />}
      {tab === "billing" && <BillingPanel mode={mode} />}
    </>
  );
}

function BusinessForm({
  initial,
  updateSettings,
  mode,
}: {
  initial: BusinessSettings;
  updateSettings: (settings: BusinessSettings) => Promise<boolean>;
  mode: string;
}) {
  const [form, setForm] = useState(initial);
  const [saved, setSaved] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    const confirmed = await updateSettings(form);
    if (!confirmed) return;
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1800);
  }
  return (
    <div className="settings-layout">
      <Card className="settings-card">
        <SectionHeading
          title="Business profile"
          description="Used across invoices, messages and reports."
        />
        <form onSubmit={submit}>
          <div className="form-grid">
            <div className="field">
              <label>Business name</label>
              <input
                required
                value={form.businessName}
                onChange={(event) =>
                  setForm({ ...form, businessName: event.target.value })
                }
              />
            </div>
            <div className="field">
              <label>Owner name</label>
              <input
                required
                value={form.ownerName}
                onChange={(event) =>
                  setForm({ ...form, ownerName: event.target.value })
                }
              />
            </div>
            <div className="field">
              <label>Business email</label>
              <input
                required
                type="email"
                value={form.email}
                onChange={(event) =>
                  setForm({ ...form, email: event.target.value })
                }
              />
            </div>
            <div className="field">
              <label>Phone</label>
              <input
                value={form.phone}
                onChange={(event) =>
                  setForm({ ...form, phone: event.target.value })
                }
              />
            </div>
            <div className="field">
              <label>Currency</label>
              <select
                value={form.currency}
                onChange={(event) =>
                  setForm({
                    ...form,
                    currency: event.target
                      .value as BusinessSettings["currency"],
                  })
                }
              >
                <option value="GBP">GBP · British pound</option>
                <option value="EUR">EUR · Euro</option>
                <option value="USD">USD · US dollar</option>
              </select>
            </div>
            <div className="field">
              <label>Invoice prefix</label>
              <input
                required
                maxLength={8}
                value={form.invoicePrefix}
                onChange={(event) =>
                  setForm({
                    ...form,
                    invoicePrefix: event.target.value.toUpperCase(),
                  })
                }
              />
            </div>
            <div className="field">
              <label>VAT rate (%)</label>
              <input
                min="0"
                max="100"
                type="number"
                value={form.vatRate}
                onChange={(event) =>
                  setForm({ ...form, vatRate: Number(event.target.value) })
                }
              />
            </div>
          </div>
          <div className="dialog-actions">
            <Button type="submit">
              <Save size={16} /> Save profile
            </Button>
          </div>
        </form>
      </Card>
      <Card className="settings-note">
        <ShieldCheck size={22} />
        <h2 style={{ marginTop: 10 }}>
          {mode === "cloud" ? "Tenant protected" : "Safe demo mode"}
        </h2>
        <p>
          {mode === "cloud"
            ? "Business records are stored in the isolated workspace and protected by row-level database security."
            : "Preview changes stay in this browser until a production account is connected."}
        </p>
      </Card>
      {saved && (
        <div className="toast">
          <CheckCircle2 size={17} /> Profile saved
        </div>
      )}
    </div>
  );
}

function AppearanceForm({
  initial,
  updateTheme,
  uploadLogo,
  canManage,
}: {
  initial: WorkspaceTheme;
  updateTheme: (theme: WorkspaceTheme) => Promise<boolean>;
  uploadLogo: (file: File) => Promise<boolean>;
  canManage: boolean;
}) {
  const [theme, setTheme] = useState(initial);
  const [uploading, setUploading] = useState(false);
  const [saved, setSaved] = useState(false);
  async function save() {
    const confirmed = await updateTheme(theme);
    if (!confirmed) return;
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1800);
  }
  async function logo(file?: File) {
    if (!file) return;
    setUploading(true);
    try {
      await uploadLogo(file);
    } finally {
      setUploading(false);
    }
  }
  return (
    <div className="appearance-layout">
      <Card className="settings-card">
        <SectionHeading
          title="Branding & appearance"
          description="A curated client identity with useful accessibility controls."
        />
        <fieldset disabled={!canManage}>
          <div className="appearance-section">
            <h3>Curated themes</h3>
            <div className="theme-presets">
              {presets.map((preset) => (
                <button
                  type="button"
                  key={preset.id}
                  className={theme.preset === preset.id ? "active" : ""}
                  onClick={() =>
                    setTheme({
                      ...theme,
                      preset: preset.id,
                      accentColor: preset.colours[1],
                    })
                  }
                >
                  <span>
                    {preset.colours.map((colour) => (
                      <i style={{ background: colour }} key={colour} />
                    ))}
                  </span>
                  <strong>{preset.name}</strong>
                  {theme.preset === preset.id && <Check size={14} />}
                </button>
              ))}
            </div>
          </div>
          <div className="appearance-form-grid">
            <div className="field">
              <label>Colour mode</label>
              <select
                value={theme.mode}
                onChange={(event) =>
                  setTheme({
                    ...theme,
                    mode: event.target.value as WorkspaceTheme["mode"],
                  })
                }
              >
                <option value="dark">Dark</option>
                <option value="light">Light</option>
                <option value="system">Match device</option>
              </select>
            </div>
            <div className="field">
              <label>Custom accent</label>
              <div className="colour-input">
                <input
                  type="color"
                  value={theme.accentColor}
                  onChange={(event) =>
                    setTheme({
                      ...theme,
                      preset: "custom",
                      accentColor: event.target.value,
                    })
                  }
                />
                <input
                  value={theme.accentColor}
                  onChange={(event) =>
                    setTheme({
                      ...theme,
                      preset: "custom",
                      accentColor: event.target.value,
                    })
                  }
                />
              </div>
            </div>
            <div className="field">
              <label>Font</label>
              <select
                value={theme.fontFamily}
                onChange={(event) =>
                  setTheme({
                    ...theme,
                    fontFamily: event.target
                      .value as WorkspaceTheme["fontFamily"],
                  })
                }
              >
                <option value="manrope">Manrope</option>
                <option value="dm-sans">DM Sans</option>
                <option value="system">System</option>
              </select>
            </div>
            <div className="field">
              <label>Interface density</label>
              <select
                value={theme.density}
                onChange={(event) =>
                  setTheme({
                    ...theme,
                    density: event.target.value as WorkspaceTheme["density"],
                  })
                }
              >
                <option value="compact">Compact</option>
                <option value="comfortable">Comfortable</option>
                <option value="spacious">Spacious</option>
              </select>
            </div>
            <div className="field field-full">
              <label>Text size · {Math.round(theme.textScale * 100)}%</label>
              <input
                type="range"
                min="0.9"
                max="1.2"
                step="0.05"
                value={theme.textScale}
                onChange={(event) =>
                  setTheme({ ...theme, textScale: Number(event.target.value) })
                }
              />
            </div>
          </div>
          <div className="accessibility-options">
            <label>
              <input
                type="checkbox"
                checked={theme.highContrast}
                onChange={(event) =>
                  setTheme({ ...theme, highContrast: event.target.checked })
                }
              />
              <Accessibility size={17} />
              <span>
                <strong>Increased contrast</strong>
                <small>Strengthens borders and secondary text.</small>
              </span>
            </label>
            <label>
              <input
                type="checkbox"
                checked={theme.reducedMotion}
                onChange={(event) =>
                  setTheme({ ...theme, reducedMotion: event.target.checked })
                }
              />
              <Accessibility size={17} />
              <span>
                <strong>Reduced motion</strong>
                <small>Minimises animation and transitions.</small>
              </span>
            </label>
          </div>
          <div className="dialog-actions">
            <Button type="button" onClick={save}>
              <Save size={16} /> Apply appearance
            </Button>
          </div>
        </fieldset>
      </Card>
      <Card className="logo-upload-card">
        <SectionHeading
          title="Client logo"
          description="Shown inside this workspace while BDB remains discreetly credited."
        />
        <div className="logo-preview">
          {initial.clientLogoUrl ? (
            <Image
              src={initial.clientLogoUrl}
              alt="Client logo"
              width={150}
              height={80}
              unoptimized
            />
          ) : (
            <span>
              <ImageUp size={26} /> Your logo
            </span>
          )}
        </div>
        <label className="button button-secondary file-button">
          {uploading ? (
            <Loader2 className="spin" size={16} />
          ) : (
            <ImageUp size={16} />
          )}{" "}
          {uploading ? "Uploading…" : "Upload logo"}
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp,image/svg+xml"
            onChange={(event) => void logo(event.target.files?.[0])}
            disabled={!canManage || uploading}
          />
        </label>
        <p>PNG, JPG, WebP or SVG · maximum 5 MB</p>
      </Card>
      {saved && (
        <div className="toast">
          <CheckCircle2 size={17} /> Appearance applied
        </div>
      )}
    </div>
  );
}

function TeamPanel({ mode, canManage }: { mode: string; canManage: boolean }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviting, setInviting] = useState(false);
  const load = useCallback(async () => {
    if (mode !== "cloud") {
      setMembers([
        {
          user_id: "demo-owner",
          role: "owner",
          status: "active",
          email: "owner@business.com",
          profiles: { full_name: "Workspace Owner" },
        },
        {
          user_id: "demo-manager",
          role: "manager",
          status: "active",
          email: "manager@business.com",
          profiles: { full_name: "Operations Manager" },
        },
      ]);
      setLoading(false);
      return;
    }
    const response = await fetch("/api/workspace/team");
    if (response.ok) setMembers((await response.json()).members);
    setLoading(false);
  }, [mode]);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mode !== "cloud") {
      alert("Connect a cloud workspace to send real invitations.");
      return;
    }
    setInviting(true);
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/workspace/team", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: form.get("email"),
        role: form.get("role"),
      }),
    });
    setInviting(false);
    if (response.ok) {
      event.currentTarget.reset();
      await load();
    } else alert((await response.json()).error);
  }
  return (
    <div className="settings-layout">
      <Card className="settings-card">
        <SectionHeading
          title="People & permissions"
          description="Roles are enforced by database policies, not just interface visibility."
        />
        {loading ? (
          <Loader2 className="spin" />
        ) : (
          <div className="team-list">
            {members.map((member) => (
              <div key={member.user_id}>
                <span className="profile-avatar">
                  {(member.profiles?.full_name || member.email)
                    .slice(0, 2)
                    .toUpperCase()}
                </span>
                <span>
                  <strong>{member.profiles?.full_name || member.email}</strong>
                  <small>
                    {member.email} · {member.status}
                  </small>
                </span>
                <span className={`role-badge ${member.role}`}>
                  {member.role === "staff" ? "Employee" : member.role}
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>
      <Card className="settings-card">
        <SectionHeading
          title="Invite team member"
          description="Owners and Managers can add people to this workspace."
        />
        <form onSubmit={invite}>
          <div className="field">
            <label>Work email</label>
            <input name="email" type="email" required disabled={!canManage} />
          </div>
          <div className="field" style={{ marginTop: 14 }}>
            <label>Role</label>
            <select name="role" disabled={!canManage}>
              <option value="staff">Employee · daily work</option>
              <option value="manager">Manager · people and settings</option>
              <option value="owner">Owner · full business control</option>
            </select>
          </div>
          <Button
            type="submit"
            disabled={!canManage || inviting}
            style={{ marginTop: 18 }}
          >
            <Plus size={16} /> {inviting ? "Sending…" : "Send invitation"}
          </Button>
        </form>
      </Card>
    </div>
  );
}

function BillingPanel({ mode }: { mode: string }) {
  const [loading, setLoading] = useState(false);
  async function portal() {
    if (mode !== "cloud") {
      alert(
        "The Stripe portal becomes available after a client subscription is connected.",
      );
      return;
    }
    setLoading(true);
    const response = await fetch("/api/workspace/billing-portal", {
      method: "POST",
    });
    const result = await response.json();
    setLoading(false);
    if (response.ok) window.location.href = result.url;
    else alert(result.error ?? "Billing portal unavailable");
  }
  return (
    <div className="settings-layout">
      <Card className="settings-card">
        <SectionHeading
          title="Plan & contract"
          description="Your BDB OS service is tailored to the workspace."
        />
        <div className="billing-plan">
          <p className="eyebrow">Current starting plan</p>
          <h2>Growth</h2>
          <p>
            Custom modules and client overrides are applied on top of this plan.
          </p>
          <div>
            <span>
              <strong>Billing</strong>
              <small>Monthly</small>
            </span>
            <span>
              <strong>Minimum commitment</strong>
              <small>6 months</small>
            </span>
            <span>
              <strong>Status</strong>
              <small>
                {mode === "cloud" ? "Managed in Stripe" : "Preview"}
              </small>
            </span>
          </div>
        </div>
      </Card>
      <Card className="settings-note">
        <CreditCard size={22} />
        <h2 style={{ marginTop: 10 }}>Billing support</h2>
        <p>
          Payment methods and invoices are handled through the secure Stripe
          customer portal. Plan changes are quoted before they affect your
          contract.
        </p>
        <Button
          variant="secondary"
          style={{ marginTop: 18 }}
          onClick={() => void portal()}
          disabled={loading}
        >
          {loading ? "Opening…" : "Open billing portal"}
        </Button>
      </Card>
    </div>
  );
}
