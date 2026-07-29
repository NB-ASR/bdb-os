"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CheckCircle2,
  RefreshCw,
  ShieldCheck,
  UserRoundCheck,
  UsersRound,
  Wrench,
  XCircle,
} from "lucide-react";
import { Badge, Button, Card, PageHeader, SectionHeading } from "@/components/ui";

type Service = {
  id: string;
  code: string;
  name: string;
  category: string | null;
  duration_minutes: number;
  status: "active";
};

type Staff = {
  user_id: string;
  name: string;
  role: string;
  access_profile: string;
};

type Eligibility = {
  workspace_id: string;
  staff_user_id: string;
  service_id: string;
  status: "active" | "archived";
  version: number;
  updated_at: string;
};

type EligibilityBundle = {
  workspaceId: string;
  canManage: boolean;
  services: Service[];
  staff: Staff[];
  eligibility: Eligibility[];
};

const emptyBundle: EligibilityBundle = {
  workspaceId: "",
  canManage: false,
  services: [],
  staff: [],
  eligibility: [],
};

export default function CalendarEligibilityPage() {
  const router = useRouter();
  const [bundle, setBundle] = useState<EligibilityBundle>(emptyBundle);
  const [selectedServiceId, setSelectedServiceId] = useState("");
  const selectedServiceRef = useRef("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [online, setOnline] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const contextResponse = await fetch("/api/workspace/context", { cache: "no-store" });
      const context = await contextResponse.json().catch(() => ({}));
      if (!contextResponse.ok || !context.currentWorkspaceId) {
        throw new Error(context.error ?? "The current workspace could not be resolved.");
      }

      const response = await fetch(
        `/api/calendar/eligibility?workspaceId=${encodeURIComponent(String(context.currentWorkspaceId))}`,
        { cache: "no-store" },
      );
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) {
        throw new Error(result.error ?? "Staff-to-Service eligibility could not be loaded.");
      }

      const next = result.result as EligibilityBundle;
      const previousServiceId = selectedServiceRef.current;
      const nextServiceId = previousServiceId
        && next.services.some((service) => service.id === previousServiceId)
        ? previousServiceId
        : next.services[0]?.id ?? "";
      selectedServiceRef.current = nextServiceId;
      setBundle(next);
      setSelectedServiceId(nextServiceId);
    } catch (loadError) {
      setError(loadError instanceof Error
        ? loadError.message
        : "Staff-to-Service eligibility could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const selectedService = bundle.services.find((service) => service.id === selectedServiceId) ?? null;
  const serviceEligibility = useMemo(
    () => bundle.eligibility.filter((item) => item.service_id === selectedServiceId),
    [bundle.eligibility, selectedServiceId],
  );
  const eligibleCount = serviceEligibility.filter((item) => item.status === "active").length;
  const disabled = !bundle.canManage || !online;

  function chooseService(serviceId: string) {
    selectedServiceRef.current = serviceId;
    setSelectedServiceId(serviceId);
    setError("");
    setNotice("");
  }

  async function changeEligibility(staff: Staff, isEligible: boolean) {
    if (!selectedService || disabled) return;
    const current = serviceEligibility.find((item) => item.staff_user_id === staff.user_id) ?? null;
    setBusy(staff.user_id);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/calendar/eligibility", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify({
          workspaceId: bundle.workspaceId,
          staffUserId: staff.user_id,
          serviceId: selectedService.id,
          isEligible,
          expectedVersion: current?.version ?? null,
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) {
        throw new Error(result.error ?? "Service eligibility could not be saved.");
      }
      setNotice(isEligible
        ? `${staff.name} can now perform ${selectedService.name}.`
        : `${staff.name} was removed from ${selectedService.name}.`);
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error
        ? saveError.message
        : "Service eligibility could not be saved.");
    } finally {
      setBusy("");
    }
  }

  if (loading && !bundle.workspaceId) {
    return <main className="admin-loading"><RefreshCw className="spin" size={20} /> Loading Service eligibility…</main>;
  }

  return (
    <>
      <PageHeader
        eyebrow="Calendar operations"
        title="Service eligibility"
        description="Choose which active staff members may be assigned to each Service."
        action={(
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            <Button variant="secondary" onClick={() => router.push("/calendar")}>Back to Calendar</Button>
            <Button variant="secondary" onClick={() => void load()} disabled={loading}>
              <RefreshCw className={loading ? "spin" : ""} size={16} /> Refresh
            </Button>
          </div>
        )}
      />

      <div className="review-callout">
        <ShieldCheck size={19} />
        <div>
          <strong>Explicit booking qualification</strong>
          <p>Appointments are accepted only when the selected staff member has an active assignment to the selected Service.</p>
        </div>
      </div>

      {!online ? (
        <Card className="settings-note">
          <strong>Online connection required</strong>
          <p>Eligibility changes are online-only because existing pending and confirmed Appointments must be checked before an assignment is removed.</p>
        </Card>
      ) : null}
      {!bundle.canManage ? (
        <Card className="settings-note">
          <strong>Read-only eligibility</strong>
          <p>Owner, Manager, an approved custom profile or guarded Founder test-write access is required to change staff assignments.</p>
        </Card>
      ) : null}
      {error ? <Card className="settings-note"><strong>Action needed</strong><p>{error}</p></Card> : null}
      {notice ? <div className="toast"><CheckCircle2 size={17} /> {notice}</div> : null}

      {!bundle.services.length ? (
        <Card className="settings-card">
          <SectionHeading title="No active Services" description="Create the Service catalogue before assigning staff eligibility." />
          <Button onClick={() => router.push("/services")}><Wrench size={16} /> Open Services</Button>
        </Card>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "minmax(260px, .75fr) minmax(0, 1.75fr)", gap: 18, alignItems: "start" }}>
          <Card className="settings-card">
            <SectionHeading title="Service" description="Assignments are maintained one Service at a time." />
            <label className="field">
              <span>Active Service</span>
              <select value={selectedServiceId} onChange={(event) => chooseService(event.target.value)}>
                {bundle.services.map((service) => (
                  <option key={service.id} value={service.id}>{service.name} · {service.code}</option>
                ))}
              </select>
            </label>
            {selectedService ? (
              <div style={{ marginTop: 16, display: "grid", gap: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span className="profile-avatar"><Wrench size={17} /></span>
                  <div>
                    <strong>{selectedService.name}</strong>
                    <small style={{ display: "block" }}>{selectedService.category || "Uncategorised"} · {selectedService.duration_minutes} min</small>
                  </div>
                </div>
                <Badge tone={eligibleCount > 0 ? "green" : "gold"}>
                  {eligibleCount} eligible staff member{eligibleCount === 1 ? "" : "s"}
                </Badge>
              </div>
            ) : null}
          </Card>

          <Card className="settings-card">
            <SectionHeading
              title="Eligible staff"
              description="Removing an assignment is blocked while pending or confirmed Appointments depend on it."
            />
            <div style={{ display: "grid", gap: 10 }}>
              {bundle.staff.map((staff) => {
                const relationship = serviceEligibility.find((item) => item.staff_user_id === staff.user_id) ?? null;
                const isEligible = relationship?.status === "active";
                return (
                  <div
                    key={staff.user_id}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: 12,
                      padding: 14,
                      border: "1px solid var(--border)",
                      borderRadius: 14,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
                      <span className="profile-avatar">{staff.name.slice(0, 2).toUpperCase()}</span>
                      <div>
                        <strong>{staff.name}</strong>
                        <small style={{ display: "block" }}>{staff.access_profile}</small>
                      </div>
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
                      <Badge tone={isEligible ? "green" : "neutral"}>{isEligible ? "Eligible" : "Not eligible"}</Badge>
                      <Button
                        variant={isEligible ? "quiet" : "secondary"}
                        onClick={() => void changeEligibility(staff, !isEligible)}
                        disabled={disabled || busy === staff.user_id}
                      >
                        {isEligible ? <XCircle size={16} /> : <UserRoundCheck size={16} />}
                        {busy === staff.user_id ? "Saving…" : isEligible ? "Remove" : "Assign"}
                      </Button>
                    </div>
                  </div>
                );
              })}
              {!bundle.staff.length ? (
                <div style={{ textAlign: "center", padding: 24 }}>
                  <UsersRound size={24} />
                  <p className="muted">No active workspace staff members are available.</p>
                </div>
              ) : null}
            </div>
          </Card>
        </div>
      )}

      <Card className="settings-note" style={{ marginTop: 18 }}>
        <strong>Scope boundary</strong>
        <p>Eligibility answers only whether a staff member may perform a Service. Working hours, breaks, leave and rooms remain separate Calendar availability records. Qualifications, certificates, commission rules and payroll are deferred.</p>
      </Card>
    </>
  );
}
