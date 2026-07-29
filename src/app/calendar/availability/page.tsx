"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  Archive,
  CalendarClock,
  CheckCircle2,
  DoorOpen,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
} from "lucide-react";
import { Badge, Button, Card, PageHeader, SectionHeading } from "@/components/ui";

type Staff = { user_id: string; name: string; role: string; access_profile: string };
type WorkingHours = {
  workspace_id: string;
  staff_user_id: string;
  weekday: number;
  start_time: string;
  end_time: string;
  is_working: boolean;
  version: number;
};
type StaffBreak = {
  id: string;
  staff_user_id: string;
  weekday: number;
  start_time: string;
  end_time: string;
  label: string;
  status: "active" | "archived";
  version: number;
};
type StaffLeave = {
  id: string;
  staff_user_id: string;
  starts_at: string;
  ends_at: string;
  reason: string;
  status: "active" | "cancelled";
  version: number;
};
type Room = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  status: "active" | "archived";
  version: number;
};
type AvailabilityBundle = {
  workspaceId: string;
  timezone: string;
  canManage: boolean;
  staff: Staff[];
  workingHours: WorkingHours[];
  breaks: StaffBreak[];
  leave: StaffLeave[];
  rooms: Room[];
};
type DayDraft = { isWorking: boolean; startTime: string; endTime: string; version: number | null };

const weekdays = [
  { value: 1, label: "Monday" },
  { value: 2, label: "Tuesday" },
  { value: 3, label: "Wednesday" },
  { value: 4, label: "Thursday" },
  { value: 5, label: "Friday" },
  { value: 6, label: "Saturday" },
  { value: 0, label: "Sunday" },
];

const emptyBundle: AvailabilityBundle = {
  workspaceId: "",
  timezone: "Europe/London",
  canManage: false,
  staff: [],
  workingHours: [],
  breaks: [],
  leave: [],
  rooms: [],
};

function timeValue(value: string) {
  return value.slice(0, 5);
}

function localInput(value: string) {
  return value ? value.replace(" ", "T").slice(0, 16) : "";
}

function dayName(value: number) {
  return weekdays.find((day) => day.value === value)?.label ?? `Day ${value}`;
}

export default function CalendarAvailabilityPage() {
  const router = useRouter();
  const [bundle, setBundle] = useState<AvailabilityBundle>(emptyBundle);
  const [selectedStaffId, setSelectedStaffId] = useState("");
  const [hours, setHours] = useState<Record<number, DayDraft>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [online, setOnline] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [breakId, setBreakId] = useState<string | null>(null);
  const [breakVersion, setBreakVersion] = useState<number | null>(null);
  const [breakWeekday, setBreakWeekday] = useState(1);
  const [breakStart, setBreakStart] = useState("12:00");
  const [breakEnd, setBreakEnd] = useState("13:00");
  const [breakLabel, setBreakLabel] = useState("Lunch break");

  const [leaveId, setLeaveId] = useState<string | null>(null);
  const [leaveVersion, setLeaveVersion] = useState<number | null>(null);
  const [leaveStart, setLeaveStart] = useState("");
  const [leaveEnd, setLeaveEnd] = useState("");
  const [leaveReason, setLeaveReason] = useState("");

  const [roomId, setRoomId] = useState<string | null>(null);
  const [roomVersion, setRoomVersion] = useState<number | null>(null);
  const [roomCode, setRoomCode] = useState("");
  const [roomName, setRoomName] = useState("");
  const [roomDescription, setRoomDescription] = useState("");

  const selectedStaff = bundle.staff.find((staff) => staff.user_id === selectedStaffId) ?? null;
  const selectedBreaks = useMemo(
    () => bundle.breaks.filter((item) => item.staff_user_id === selectedStaffId),
    [bundle.breaks, selectedStaffId],
  );
  const selectedLeave = useMemo(
    () => bundle.leave.filter((item) => item.staff_user_id === selectedStaffId),
    [bundle.leave, selectedStaffId],
  );

  const buildHoursDraft = useCallback((data: AvailabilityBundle, staffId: string) => {
    setHours(Object.fromEntries(weekdays.map((day) => {
      const existing = data.workingHours.find((item) => item.staff_user_id === staffId && item.weekday === day.value);
      return [day.value, {
        isWorking: existing?.is_working ?? false,
        startTime: existing ? timeValue(existing.start_time) : "09:00",
        endTime: existing ? timeValue(existing.end_time) : "17:00",
        version: existing?.version ?? null,
      } satisfies DayDraft];
    })));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const contextResponse = await fetch("/api/workspace/context", { cache: "no-store" });
      const context = await contextResponse.json().catch(() => ({}));
      if (!contextResponse.ok || !context.currentWorkspaceId) throw new Error(context.error ?? "The current workspace could not be resolved.");
      const response = await fetch(`/api/calendar/availability?workspaceId=${encodeURIComponent(String(context.currentWorkspaceId))}`, { cache: "no-store" });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) throw new Error(result.error ?? "Calendar availability could not be loaded.");
      const next = result.result as AvailabilityBundle;
      setBundle(next);
      const nextStaffId = selectedStaffId && next.staff.some((staff) => staff.user_id === selectedStaffId)
        ? selectedStaffId
        : next.staff[0]?.user_id ?? "";
      setSelectedStaffId(nextStaffId);
      buildHoursDraft(next, nextStaffId);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Calendar availability could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [buildHoursDraft, selectedStaffId]);

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

  useEffect(() => { void load(); }, [load]);

  function chooseStaff(staffId: string) {
    setSelectedStaffId(staffId);
    buildHoursDraft(bundle, staffId);
    resetBreak();
    resetLeave();
  }

  async function command(entityType: string, action: string, payload: Record<string, unknown>) {
    if (!online) throw new Error("Availability configuration is online-only because existing Appointments must be checked atomically.");
    const response = await fetch("/api/calendar/availability", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify({ workspaceId: bundle.workspaceId, entityType, action, ...payload }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.ok) throw new Error(result.error ?? "Calendar availability could not be saved.");
    return result.result as Record<string, unknown>;
  }

  async function saveHours(day: number) {
    const draft = hours[day];
    if (!draft || !selectedStaffId) return;
    setBusy(`hours-${day}`);
    setError("");
    setNotice("");
    try {
      await command("working_hours", "set", {
        staffUserId: selectedStaffId,
        weekday: day,
        startTime: draft.startTime,
        endTime: draft.endTime,
        isWorking: draft.isWorking,
        expectedVersion: draft.version,
      });
      setNotice(`${dayName(day)} working hours saved.`);
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Working hours could not be saved.");
    } finally {
      setBusy("");
    }
  }

  function resetBreak() {
    setBreakId(null);
    setBreakVersion(null);
    setBreakWeekday(1);
    setBreakStart("12:00");
    setBreakEnd("13:00");
    setBreakLabel("Lunch break");
  }

  async function saveBreak(event: FormEvent) {
    event.preventDefault();
    if (!selectedStaffId) return;
    setBusy("break");
    setError("");
    setNotice("");
    try {
      await command("break", breakId ? "update" : "create", {
        id: breakId ?? crypto.randomUUID(),
        expectedVersion: breakVersion,
        staffUserId: selectedStaffId,
        weekday: breakWeekday,
        startTime: breakStart,
        endTime: breakEnd,
        name: breakLabel,
      });
      setNotice(breakId ? "Staff break updated." : "Staff break created.");
      resetBreak();
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Staff break could not be saved.");
    } finally {
      setBusy("");
    }
  }

  async function archiveBreak(item: StaffBreak) {
    setBusy(`break-${item.id}`);
    setError("");
    try {
      await command("break", "archive", { id: item.id, expectedVersion: item.version });
      setNotice("Staff break archived.");
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Staff break could not be archived.");
    } finally {
      setBusy("");
    }
  }

  function editBreak(item: StaffBreak) {
    setBreakId(item.id);
    setBreakVersion(item.version);
    setBreakWeekday(item.weekday);
    setBreakStart(timeValue(item.start_time));
    setBreakEnd(timeValue(item.end_time));
    setBreakLabel(item.label);
  }

  function resetLeave() {
    setLeaveId(null);
    setLeaveVersion(null);
    setLeaveStart("");
    setLeaveEnd("");
    setLeaveReason("");
  }

  async function saveLeave(event: FormEvent) {
    event.preventDefault();
    if (!selectedStaffId) return;
    setBusy("leave");
    setError("");
    setNotice("");
    try {
      await command("leave", leaveId ? "update" : "create", {
        id: leaveId ?? crypto.randomUUID(),
        expectedVersion: leaveVersion,
        staffUserId: selectedStaffId,
        startsAt: leaveStart,
        endsAt: leaveEnd,
        reason: leaveReason,
      });
      setNotice(leaveId ? "Staff leave updated." : "Staff leave recorded.");
      resetLeave();
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Staff leave could not be saved.");
    } finally {
      setBusy("");
    }
  }

  async function cancelLeave(item: StaffLeave) {
    setBusy(`leave-${item.id}`);
    setError("");
    try {
      await command("leave", "cancel", { id: item.id, expectedVersion: item.version });
      setNotice("Staff leave cancelled.");
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Staff leave could not be cancelled.");
    } finally {
      setBusy("");
    }
  }

  function editLeave(item: StaffLeave) {
    setLeaveId(item.id);
    setLeaveVersion(item.version);
    setLeaveStart(localInput(item.starts_at));
    setLeaveEnd(localInput(item.ends_at));
    setLeaveReason(item.reason);
  }

  function resetRoom() {
    setRoomId(null);
    setRoomVersion(null);
    setRoomCode("");
    setRoomName("");
    setRoomDescription("");
  }

  async function saveRoom(event: FormEvent) {
    event.preventDefault();
    setBusy("room");
    setError("");
    setNotice("");
    try {
      await command("room", roomId ? "update" : "create", {
        id: roomId ?? crypto.randomUUID(),
        expectedVersion: roomVersion,
        code: roomCode,
        name: roomName,
        description: roomDescription,
      });
      setNotice(roomId ? "Room updated." : "Room created.");
      resetRoom();
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Room could not be saved.");
    } finally {
      setBusy("");
    }
  }

  async function changeRoomStatus(room: Room) {
    setBusy(`room-${room.id}`);
    setError("");
    try {
      await command("room", room.status === "active" ? "archive" : "restore", {
        id: room.id,
        expectedVersion: room.version,
      });
      setNotice(room.status === "active" ? "Room archived." : "Room restored.");
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Room status could not be changed.");
    } finally {
      setBusy("");
    }
  }

  function editRoom(room: Room) {
    setRoomId(room.id);
    setRoomVersion(room.version);
    setRoomCode(String(room.code));
    setRoomName(room.name);
    setRoomDescription(room.description ?? "");
  }

  if (loading && !bundle.workspaceId) {
    return <main className="admin-loading"><RefreshCw className="spin" size={20} /> Loading availability…</main>;
  }

  const disabled = !bundle.canManage || !online;

  return (
    <>
      <PageHeader
        eyebrow="Calendar operations"
        title="Availability"
        description="Define working hours, recurring breaks, leave and rooms before Appointments are accepted."
        action={(
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            <Button variant="secondary" onClick={() => router.push("/calendar")}>Back to Calendar</Button>
            <Button variant="secondary" onClick={() => void load()} disabled={loading}><RefreshCw className={loading ? "spin" : ""} size={16} /> Refresh</Button>
          </div>
        )}
      />

      <div className="review-callout">
        <ShieldCheck size={19} />
        <div>
          <strong>Authoritative availability boundary</strong>
          <p>Every active Appointment is checked against effective working hours, recurring breaks, leave, staff overlap and room overlap in one database transaction.</p>
        </div>
      </div>

      {!online ? <Card className="settings-note"><strong>Online connection required</strong><p>Availability changes are not queued offline because existing Appointments must be checked before a schedule or room is changed.</p></Card> : null}
      {!bundle.canManage ? <Card className="settings-note"><strong>Read-only availability</strong><p>Owner, Manager, an approved custom profile or guarded Founder test-write access is required to change Calendar availability.</p></Card> : null}
      {error ? <Card className="settings-note"><strong>Action needed</strong><p>{error}</p></Card> : null}
      {notice ? <div className="toast"><CheckCircle2 size={17} /> {notice}</div> : null}

      <div style={{ display: "grid", gridTemplateColumns: "minmax(260px, .7fr) minmax(0, 2fr)", gap: 18, alignItems: "start" }}>
        <Card className="settings-card">
          <SectionHeading title="Staff member" description={`Times are stored in ${bundle.timezone}.`} />
          <label className="field">
            <span>Staff</span>
            <select value={selectedStaffId} onChange={(event) => chooseStaff(event.target.value)}>
              <option value="">Choose staff</option>
              {bundle.staff.map((staff) => <option key={staff.user_id} value={staff.user_id}>{staff.name}</option>)}
            </select>
          </label>
          {selectedStaff ? (
            <div style={{ marginTop: 16, display: "flex", gap: 10, alignItems: "center" }}>
              <span className="profile-avatar">{selectedStaff.name.slice(0, 2).toUpperCase()}</span>
              <div><strong>{selectedStaff.name}</strong><small style={{ display: "block" }}>{selectedStaff.access_profile}</small></div>
            </div>
          ) : null}
        </Card>

        <Card className="settings-card">
          <SectionHeading title="Weekly working hours" description="Preparation and recovery buffers must also fit inside the configured interval." />
          <div style={{ display: "grid", gap: 10 }}>
            {weekdays.map((day) => {
              const draft = hours[day.value] ?? { isWorking: false, startTime: "09:00", endTime: "17:00", version: null };
              return (
                <div key={day.value} style={{ display: "grid", gridTemplateColumns: "minmax(110px, 1fr) auto 110px 110px auto", gap: 10, alignItems: "center", padding: 12, border: "1px solid var(--border)", borderRadius: 14 }}>
                  <strong>{day.label}</strong>
                  <label style={{ display: "flex", gap: 7, alignItems: "center" }}><input type="checkbox" checked={draft.isWorking} onChange={(event) => setHours((current) => ({ ...current, [day.value]: { ...draft, isWorking: event.target.checked } }))} disabled={disabled} /> Working</label>
                  <input type="time" value={draft.startTime} onChange={(event) => setHours((current) => ({ ...current, [day.value]: { ...draft, startTime: event.target.value } }))} disabled={disabled || !draft.isWorking} />
                  <input type="time" value={draft.endTime} onChange={(event) => setHours((current) => ({ ...current, [day.value]: { ...draft, endTime: event.target.value } }))} disabled={disabled || !draft.isWorking} />
                  <Button variant="secondary" onClick={() => void saveHours(day.value)} disabled={disabled || busy === `hours-${day.value}`}>{busy === `hours-${day.value}` ? "Saving…" : "Save"}</Button>
                </div>
              );
            })}
          </div>
        </Card>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 18, marginTop: 18, alignItems: "start" }}>
        <Card className="settings-card">
          <SectionHeading title="Recurring breaks" description="A break blocks the full effective occupied time of an Appointment." />
          <form onSubmit={(event) => void saveBreak(event)} style={{ display: "grid", gap: 12 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <label className="field"><span>Day</span><select value={breakWeekday} onChange={(event) => setBreakWeekday(Number(event.target.value))} disabled={disabled}>{weekdays.map((day) => <option key={day.value} value={day.value}>{day.label}</option>)}</select></label>
              <label className="field"><span>Label</span><input value={breakLabel} maxLength={120} onChange={(event) => setBreakLabel(event.target.value)} disabled={disabled} required /></label>
              <label className="field"><span>Starts</span><input type="time" value={breakStart} onChange={(event) => setBreakStart(event.target.value)} disabled={disabled} required /></label>
              <label className="field"><span>Ends</span><input type="time" value={breakEnd} onChange={(event) => setBreakEnd(event.target.value)} disabled={disabled} required /></label>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <Button type="submit" disabled={disabled || !selectedStaffId || busy === "break"}><Plus size={16} /> {breakId ? "Save break" : "Add break"}</Button>
              {breakId ? <Button type="button" variant="quiet" onClick={resetBreak}>Cancel edit</Button> : null}
            </div>
          </form>
          <div style={{ display: "grid", gap: 8, marginTop: 18 }}>
            {selectedBreaks.filter((item) => item.status === "active").map((item) => (
              <div key={item.id} style={{ display: "flex", gap: 10, alignItems: "center", justifyContent: "space-between", padding: 10, border: "1px solid var(--border)", borderRadius: 12 }}>
                <div><strong>{item.label}</strong><small style={{ display: "block" }}>{dayName(item.weekday)} · {timeValue(item.start_time)}–{timeValue(item.end_time)}</small></div>
                <div style={{ display: "flex", gap: 6 }}><Button variant="quiet" onClick={() => editBreak(item)} disabled={disabled}><Pencil size={15} /></Button><Button variant="quiet" onClick={() => void archiveBreak(item)} disabled={disabled || busy === `break-${item.id}`}><Archive size={15} /></Button></div>
              </div>
            ))}
            {!selectedBreaks.some((item) => item.status === "active") ? <p className="muted small">No active recurring breaks.</p> : null}
          </div>
        </Card>

        <Card className="settings-card">
          <SectionHeading title="Leave and time off" description={`Date and time values use ${bundle.timezone}.`} />
          <form onSubmit={(event) => void saveLeave(event)} style={{ display: "grid", gap: 12 }}>
            <label className="field"><span>Starts</span><input type="datetime-local" value={leaveStart} onChange={(event) => setLeaveStart(event.target.value)} disabled={disabled} required /></label>
            <label className="field"><span>Ends</span><input type="datetime-local" value={leaveEnd} onChange={(event) => setLeaveEnd(event.target.value)} disabled={disabled} required /></label>
            <label className="field"><span>Reason</span><input value={leaveReason} maxLength={500} onChange={(event) => setLeaveReason(event.target.value)} disabled={disabled} required /></label>
            <div style={{ display: "flex", gap: 8 }}>
              <Button type="submit" disabled={disabled || !selectedStaffId || busy === "leave"}><CalendarClock size={16} /> {leaveId ? "Save leave" : "Record leave"}</Button>
              {leaveId ? <Button type="button" variant="quiet" onClick={resetLeave}>Cancel edit</Button> : null}
            </div>
          </form>
          <div style={{ display: "grid", gap: 8, marginTop: 18 }}>
            {selectedLeave.filter((item) => item.status === "active").map((item) => (
              <div key={item.id} style={{ display: "flex", gap: 10, alignItems: "center", justifyContent: "space-between", padding: 10, border: "1px solid var(--border)", borderRadius: 12 }}>
                <div><strong>{item.reason}</strong><small style={{ display: "block" }}>{localInput(item.starts_at).replace("T", " ")} → {localInput(item.ends_at).replace("T", " ")}</small></div>
                <div style={{ display: "flex", gap: 6 }}><Button variant="quiet" onClick={() => editLeave(item)} disabled={disabled}><Pencil size={15} /></Button><Button variant="quiet" onClick={() => void cancelLeave(item)} disabled={disabled || busy === `leave-${item.id}`}><Archive size={15} /></Button></div>
              </div>
            ))}
            {!selectedLeave.some((item) => item.status === "active") ? <p className="muted small">No active leave recorded.</p> : null}
          </div>
        </Card>
      </div>

      <Card className="settings-card" style={{ marginTop: 18 }}>
        <SectionHeading title="Rooms and resources" description="Active rooms can be assigned to Appointments and cannot overlap." />
        <div style={{ display: "grid", gridTemplateColumns: "minmax(280px, .8fr) minmax(0, 1.5fr)", gap: 18, alignItems: "start" }}>
          <form onSubmit={(event) => void saveRoom(event)} style={{ display: "grid", gap: 12 }}>
            <label className="field"><span>Code</span><input value={roomCode} maxLength={32} placeholder="TREATMENT-1" onChange={(event) => setRoomCode(event.target.value)} disabled={disabled} required /></label>
            <label className="field"><span>Name</span><input value={roomName} maxLength={120} placeholder="Treatment Room 1" onChange={(event) => setRoomName(event.target.value)} disabled={disabled} required /></label>
            <label className="field"><span>Description</span><textarea value={roomDescription} maxLength={1000} rows={3} onChange={(event) => setRoomDescription(event.target.value)} disabled={disabled} /></label>
            <div style={{ display: "flex", gap: 8 }}>
              <Button type="submit" disabled={disabled || busy === "room"}><DoorOpen size={16} /> {roomId ? "Save room" : "Create room"}</Button>
              {roomId ? <Button type="button" variant="quiet" onClick={resetRoom}>Cancel edit</Button> : null}
            </div>
          </form>
          <div style={{ display: "grid", gap: 8 }}>
            {bundle.rooms.map((room) => (
              <div key={room.id} style={{ display: "flex", gap: 12, alignItems: "center", justifyContent: "space-between", padding: 12, border: "1px solid var(--border)", borderRadius: 14 }}>
                <div style={{ display: "flex", gap: 10, alignItems: "center" }}><DoorOpen size={18} /><div><strong>{room.name}</strong><small style={{ display: "block" }}>{String(room.code)} · {room.description || "No description"}</small></div></div>
                <div style={{ display: "flex", gap: 7, alignItems: "center" }}><Badge tone={room.status === "active" ? "green" : "neutral"}>{room.status}</Badge><Button variant="quiet" onClick={() => editRoom(room)} disabled={disabled}><Pencil size={15} /></Button><Button variant="quiet" onClick={() => void changeRoomStatus(room)} disabled={disabled || busy === `room-${room.id}`}>{room.status === "active" ? <Archive size={15} /> : <RotateCcw size={15} />}</Button></div>
              </div>
            ))}
            {!bundle.rooms.length ? <p className="muted small">No rooms configured. Appointments may remain unassigned.</p> : null}
          </div>
        </div>
      </Card>

      <Card className="settings-note" style={{ marginTop: 18 }}>
        <strong>Scope boundary</strong>
        <p>Staff-to-Service eligibility remains the next Calendar integration. Timesheets, Meetings, reminders and external calendar synchronisation are still deferred.</p>
      </Card>
    </>
  );
}
