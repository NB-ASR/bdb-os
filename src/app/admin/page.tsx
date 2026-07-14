"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import {
  Activity,
  Building2,
  Check,
  ChevronDown,
  CircleDollarSign,
  CreditCard,
  KeyRound,
  Loader2,
  Plus,
  RefreshCw,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  UsersRound,
} from "lucide-react";
import { BdbMonogram } from "@/components/brand";

type Plan = {
  id: string;
  code: string;
  name: string;
  description: string;
  is_active: boolean;
};
type Feature = {
  key: string;
  name: string;
  description: string;
  category: string;
  route: string | null;
};
type Workspace = {
  id: string;
  name: string;
  slug: string;
  status: string;
  plan_id: string | null;
  created_at: string;
};
type Entitlement = { plan_id: string; feature_key: string; enabled: boolean };
type Override = {
  workspace_id: string;
  feature_key: string;
  enabled: boolean;
  reason: string | null;
};
type Subscription = {
  workspace_id: string;
  status: string;
  current_period_end: string | null;
};
type Contract = {
  workspace_id: string;
  minimum_term_months: number;
  monthly_amount: number | null;
  status: string;
};
type Audit = {
  id: number;
  action: string;
  created_at: string;
  workspace_id: string | null;
  metadata: Record<string, unknown>;
};
type Dashboard = {
  workspaces: Workspace[];
  plans: Plan[];
  features: Feature[];
  planFeatures: Entitlement[];
  overrides: Override[];
  subscriptions: Subscription[];
  contracts: Contract[];
  memberships: unknown[];
  audit: Audit[];
};

const demo: Dashboard = {
  workspaces: [
    {
      id: "demo-1",
      name: "Stone & Co Events",
      slug: "stone-events",
      status: "active",
      plan_id: "growth",
      created_at: "2026-07-01",
    },
    {
      id: "demo-2",
      name: "Northstar Fitness",
      slug: "northstar",
      status: "trial",
      plan_id: "starter",
      created_at: "2026-07-09",
    },
  ],
  plans: [
    {
      id: "starter",
      code: "starter",
      name: "Starter",
      description: "A focused core workspace",
      is_active: true,
    },
    {
      id: "growth",
      code: "growth",
      name: "Growth",
      description: "Connected operations for a growing team",
      is_active: true,
    },
    {
      id: "pro",
      code: "pro",
      name: "Pro",
      description: "The complete tailored foundation",
      is_active: true,
    },
  ],
  features: [
    {
      key: "accounts",
      name: "Accounts",
      description: "Invoices and payments",
      category: "operations",
      route: "/accounts",
    },
    {
      key: "customers",
      name: "Customers",
      description: "Connected customer records",
      category: "operations",
      route: "/customers",
    },
    {
      key: "calendar",
      name: "Calendar",
      description: "Bookings and availability",
      category: "operations",
      route: "/calendar",
    },
    {
      key: "reports",
      name: "Reports",
      description: "Performance reporting",
      category: "insight",
      route: "/reports",
    },
    {
      key: "automation",
      name: "Automation",
      description: "Approved smart workflows",
      category: "system",
      route: "/automation-hub",
    },
    {
      key: "appearance",
      name: "Appearance",
      description: "Client branding and accessibility",
      category: "system",
      route: "/settings",
    },
  ],
  planFeatures: [
    { plan_id: "starter", feature_key: "accounts", enabled: true },
    { plan_id: "starter", feature_key: "customers", enabled: true },
    { plan_id: "growth", feature_key: "accounts", enabled: true },
    { plan_id: "growth", feature_key: "customers", enabled: true },
    { plan_id: "growth", feature_key: "calendar", enabled: true },
    { plan_id: "growth", feature_key: "reports", enabled: true },
    { plan_id: "pro", feature_key: "accounts", enabled: true },
    { plan_id: "pro", feature_key: "customers", enabled: true },
    { plan_id: "pro", feature_key: "calendar", enabled: true },
    { plan_id: "pro", feature_key: "reports", enabled: true },
    { plan_id: "pro", feature_key: "automation", enabled: true },
    { plan_id: "pro", feature_key: "appearance", enabled: true },
  ],
  overrides: [],
  subscriptions: [
    {
      workspace_id: "demo-1",
      status: "active",
      current_period_end: "2026-08-01",
    },
  ],
  contracts: [
    {
      workspace_id: "demo-1",
      minimum_term_months: 6,
      monthly_amount: 495,
      status: "active",
    },
  ],
  memberships: [],
  audit: [
    {
      id: 1,
      action: "workspace.created",
      created_at: "2026-07-14T08:00:00Z",
      workspace_id: "demo-2",
      metadata: {},
    },
  ],
};

export default function AdminPage() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [demoMode, setDemoMode] = useState(false);
  const [tab, setTab] = useState<"clients" | "plans" | "audit">("clients");
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/admin", { cache: "no-store" });
      if (response.status === 428) {
        window.location.href = "/mfa";
        return;
      }
      if (response.status === 401) {
        window.location.href = "/login?next=/admin";
        return;
      }
      if (!response.ok) throw new Error("Admin API unavailable");
      setData(await response.json());
      setDemoMode(false);
    } catch {
      setData(demo);
      setDemoMode(true);
    }
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function mutate(payload: Record<string, unknown>, key: string) {
    if (demoMode) {
      setBusy(key);
      window.setTimeout(() => setBusy(""), 700);
      return;
    }
    setBusy(key);
    const response = await fetch("/api/admin", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    setBusy("");
    if (response.ok) await load();
    else alert((await response.json()).error ?? "Could not save change");
  }
  async function createBillingLink(workspaceId: string) {
    if (demoMode) {
      alert(
        "Connect Stripe and the production environment variables to create a live billing link.",
      );
      return;
    }
    const quote = window.prompt(
      "Agreed monthly amount in GBP (for example 495):",
    );
    if (!quote) return;
    const term = window.prompt("Minimum commitment in months: 3 or 6", "6");
    if (!term) return;
    const trial = window.prompt("Trial days: 0, 7, 14 or 30", "0");
    if (trial === null) return;
    setBusy("billing");
    const response = await fetch("/api/admin/billing-link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workspaceId,
        monthlyAmount: Number(quote),
        termMonths: Number(term),
        trialDays: Number(trial),
      }),
    });
    setBusy("");
    const result = await response.json();
    if (response.ok && result.url)
      window.open(result.url, "_blank", "noopener,noreferrer");
    else alert(result.error ?? "Could not create billing link");
  }

  if (!data)
    return (
      <main className="admin-loading">
        <Loader2 className="spin" /> Loading secure control plane…
      </main>
    );
  const activeWorkspace =
    data.workspaces.find((item) => item.id === selected) ?? data.workspaces[0];
  const activePlan = data.plans.find(
    (item) => item.id === activeWorkspace?.plan_id,
  );
  const subscription = data.subscriptions.find(
    (item) => item.workspace_id === activeWorkspace?.id,
  );
  const contract = data.contracts.find(
    (item) => item.workspace_id === activeWorkspace?.id,
  );

  return (
    <main className="admin-shell">
      <aside className="admin-sidebar">
        <BdbMonogram />
        <p className="admin-label">Founder control plane</p>
        <nav>
          <button
            className={tab === "clients" ? "active" : ""}
            onClick={() => setTab("clients")}
          >
            <Building2 size={18} /> Clients
          </button>
          <button
            className={tab === "plans" ? "active" : ""}
            onClick={() => setTab("plans")}
          >
            <SlidersHorizontal size={18} /> Plans & features
          </button>
          <button
            className={tab === "audit" ? "active" : ""}
            onClick={() => setTab("audit")}
          >
            <Activity size={18} /> Audit trail
          </button>
        </nav>
        <div className="admin-secure">
          <ShieldCheck size={17} />
          <span>
            <strong>MFA protected</strong>
            <small>Founder actions audited</small>
          </span>
        </div>
      </aside>
      <section className="admin-main">
        <header className="admin-topbar">
          <div>
            <p className="eyebrow">admin.bdb-os.com</p>
            <h1>
              {tab === "clients"
                ? "Client workspaces"
                : tab === "plans"
                  ? "Plans & entitlements"
                  : "Platform audit trail"}
            </h1>
          </div>
          <div className="admin-top-actions">
            {demoMode && <span className="admin-demo">Preview data</span>}
            <button
              className="icon-button"
              onClick={() => void load()}
              aria-label="Refresh"
            >
              <RefreshCw size={16} />
            </button>
            {tab === "clients" && (
              <button
                className="button button-primary"
                onClick={() => setCreating(true)}
              >
                <Plus size={16} /> New client
              </button>
            )}
          </div>
        </header>
        <div className="admin-stats">
          <div>
            <span>
              <Building2 size={17} />
            </span>
            <small>Client workspaces</small>
            <strong>{data.workspaces.length}</strong>
          </div>
          <div>
            <span>
              <UsersRound size={17} />
            </span>
            <small>Active clients</small>
            <strong>
              {
                data.workspaces.filter((item) => item.status === "active")
                  .length
              }
            </strong>
          </div>
          <div>
            <span>
              <CircleDollarSign size={17} />
            </span>
            <small>Live subscriptions</small>
            <strong>
              {
                data.subscriptions.filter((item) => item.status === "active")
                  .length
              }
            </strong>
          </div>
          <div>
            <span>
              <KeyRound size={17} />
            </span>
            <small>Feature overrides</small>
            <strong>{data.overrides.length}</strong>
          </div>
        </div>
        {tab === "clients" && (
          <div className="admin-client-layout">
            <div className="admin-client-list">
              {data.workspaces.map((workspace) => (
                <button
                  key={workspace.id}
                  className={
                    workspace.id === activeWorkspace?.id ? "active" : ""
                  }
                  onClick={() => setSelected(workspace.id)}
                >
                  <span className="client-initial">
                    {workspace.name.slice(0, 2).toUpperCase()}
                  </span>
                  <span>
                    <strong>{workspace.name}</strong>
                    <small>
                      {data.plans.find((plan) => plan.id === workspace.plan_id)
                        ?.name ?? "Custom"}{" "}
                      · {workspace.status}
                    </small>
                  </span>
                  <ChevronDown size={15} />
                </button>
              ))}
            </div>
            {activeWorkspace && (
              <div className="admin-detail">
                <div className="admin-detail-head">
                  <div>
                    <p className="eyebrow">{activeWorkspace.slug}.bdb-os.com</p>
                    <h2>{activeWorkspace.name}</h2>
                  </div>
                  <select
                    value={activeWorkspace.status}
                    onChange={(event) =>
                      void mutate(
                        {
                          action: "workspace-status",
                          workspaceId: activeWorkspace.id,
                          status: event.target.value,
                        },
                        "status",
                      )
                    }
                  >
                    <option value="trial">Trial</option>
                    <option value="active">Active</option>
                    <option value="suspended">Suspended</option>
                    <option value="cancelled">Cancelled</option>
                  </select>
                </div>
                <div className="admin-detail-grid">
                  <div>
                    <small>Plan</small>
                    <select
                      value={activeWorkspace.plan_id ?? ""}
                      onChange={(event) =>
                        void mutate(
                          {
                            action: "workspace-plan",
                            workspaceId: activeWorkspace.id,
                            planId: event.target.value,
                          },
                          "plan",
                        )
                      }
                    >
                      {data.plans.map((plan) => (
                        <option key={plan.id} value={plan.id}>
                          {plan.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <small>Subscription</small>
                    <strong>{subscription?.status ?? "Not started"}</strong>
                  </div>
                  <div>
                    <small>Minimum term</small>
                    <strong>
                      {contract
                        ? `${contract.minimum_term_months} months`
                        : "Not agreed"}
                    </strong>
                  </div>
                  <div>
                    <small>Monthly quote</small>
                    <strong>
                      {contract?.monthly_amount
                        ? `£${Number(contract.monthly_amount).toLocaleString()}`
                        : "Custom quote"}
                    </strong>
                  </div>
                </div>
                <div className="billing-action">
                  <div>
                    <strong>Custom subscription</strong>
                    <p>
                      Create a Stripe checkout link using the agreed quote,
                      trial and 3/6-month contract.
                    </p>
                  </div>
                  <button
                    className="button button-secondary"
                    onClick={() => void createBillingLink(activeWorkspace.id)}
                    disabled={busy === "billing"}
                  >
                    <CreditCard size={15} />{" "}
                    {busy === "billing" ? "Creating…" : "Create billing link"}
                  </button>
                </div>
                <h3>Client feature overrides</h3>
                <p className="muted small">
                  Overrides take priority over the{" "}
                  {activePlan?.name ?? "selected"} plan and are enforced by
                  database policies.
                </p>
                <div className="entitlement-grid">
                  {data.features.map((feature) => {
                    const override = data.overrides.find(
                      (item) =>
                        item.workspace_id === activeWorkspace.id &&
                        item.feature_key === feature.key,
                    );
                    const planEnabled = data.planFeatures.some(
                      (item) =>
                        item.plan_id === activeWorkspace.plan_id &&
                        item.feature_key === feature.key &&
                        item.enabled,
                    );
                    const enabled = override?.enabled ?? planEnabled;
                    return (
                      <button
                        key={feature.key}
                        className={enabled ? "enabled" : ""}
                        onClick={() =>
                          void mutate(
                            {
                              action: "feature-override",
                              workspaceId: activeWorkspace.id,
                              featureKey: feature.key,
                              enabled: !enabled,
                              reason: "Founder dashboard override",
                            },
                            `feature-${feature.key}`,
                          )
                        }
                      >
                        <span>{enabled && <Check size={14} />}</span>
                        <div>
                          <strong>{feature.name}</strong>
                          <small>
                            {override
                              ? "Client override"
                              : planEnabled
                                ? `${activePlan?.name} default`
                                : "Not included"}
                          </small>
                        </div>
                        {busy === `feature-${feature.key}` && (
                          <Loader2 className="spin" size={14} />
                        )}
                      </button>
                    );
                  })}
                </div>
                <div className="support-access">
                  <ShieldCheck size={20} />
                  <div>
                    <strong>Audited support access</strong>
                    <p>
                      Opening client data for support must record the founder,
                      workspace, reason and time.
                    </p>
                  </div>
                    <button
                      className="button button-secondary"
                      onClick={() => {
                        const reason = window.prompt(
                          "Why do you need support access to this workspace?",
                        );
                        if (reason)
                          void mutate(
                            {
                              action: "support-access",
                              workspaceId: activeWorkspace.id,
                              reason,
                            },
                            "support",
                          );
                      }}
                    >
                    Request access
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
        {tab === "plans" && (
          <div className="admin-plan-grid">
            {data.plans.map((plan) => (
              <article key={plan.id}>
                <p className="eyebrow">Custom quote</p>
                <h2>{plan.name}</h2>
                <p>{plan.description}</p>
                <div className="plan-feature-list">
                  {data.features.map((feature) => {
                    const enabled = data.planFeatures.some(
                      (item) =>
                        item.plan_id === plan.id &&
                        item.feature_key === feature.key &&
                        item.enabled,
                    );
                    return (
                      <button
                        key={feature.key}
                        className={enabled ? "enabled" : ""}
                        onClick={() =>
                          void mutate(
                            {
                              action: "plan-feature",
                              planId: plan.id,
                              featureKey: feature.key,
                              enabled: !enabled,
                            },
                            `plan-${plan.id}-${feature.key}`,
                          )
                        }
                      >
                        <span>{enabled && <Check size={13} />}</span>
                        {feature.name}
                      </button>
                    );
                  })}
                </div>
              </article>
            ))}
          </div>
        )}
        {tab === "audit" && (
          <div className="audit-table">
            <div className="audit-row audit-head">
              <span>Action</span>
              <span>Workspace</span>
              <span>Time</span>
            </div>
            {data.audit.map((item) => (
              <div className="audit-row" key={item.id}>
                <span>
                  <Settings2 size={15} />
                  <strong>{item.action}</strong>
                </span>
                <span>
                  {data.workspaces.find(
                    (workspace) => workspace.id === item.workspace_id,
                  )?.name ?? "Platform"}
                </span>
                <span>{new Date(item.created_at).toLocaleString()}</span>
              </div>
            ))}
          </div>
        )}
      </section>
      {creating && (
        <CreateWorkspace
          plans={data.plans}
          onClose={() => setCreating(false)}
          onCreated={load}
          demoMode={demoMode}
        />
      )}
    </main>
  );
}

function CreateWorkspace({
  plans,
  onClose,
  onCreated,
  demoMode,
}: {
  plans: Plan[];
  onClose: () => void;
  onCreated: () => Promise<void>;
  demoMode: boolean;
}) {
  const [loading, setLoading] = useState(false);
  const defaultPlan = plans[0]?.id ?? "";
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (demoMode) {
      alert(
        "Connect the production Supabase variables to create and invite a real client.",
      );
      return;
    }
    setLoading(true);
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/admin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "create-workspace",
        name: form.get("name"),
        slug: form.get("slug"),
        ownerEmail: form.get("email"),
        planId: form.get("plan"),
      }),
    });
    setLoading(false);
    if (response.ok) {
      await onCreated();
      onClose();
    } else alert((await response.json()).error ?? "Could not create client");
  }
  return (
    <div className="dialog-backdrop">
      <div className="dialog">
        <div className="dialog-header">
          <div>
            <p className="eyebrow">Provision tenant</p>
            <h2>Create client workspace</h2>
            <p className="muted">
              Creates the isolated tenant, default theme and owner invitation.
            </p>
          </div>
          <button className="icon-button" onClick={onClose}>
            ×
          </button>
        </div>
        <form onSubmit={submit}>
          <div className="form-grid">
            <div className="field">
              <label>Business name</label>
              <input name="name" required />
            </div>
            <div className="field">
              <label>Workspace slug</label>
              <input name="slug" required pattern="[a-z0-9-]+" />
            </div>
            <div className="field field-full">
              <label>Owner email</label>
              <input name="email" type="email" required />
            </div>
            <div className="field field-full">
              <label>Starting plan</label>
              <select name="plan" defaultValue={defaultPlan}>
                {plans.map((plan) => (
                  <option key={plan.id} value={plan.id}>
                    {plan.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="dialog-actions">
            <button
              type="button"
              className="button button-secondary"
              onClick={onClose}
            >
              Cancel
            </button>
            <button className="button button-primary" disabled={loading}>
              {loading ? "Creating…" : "Create and invite owner"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
