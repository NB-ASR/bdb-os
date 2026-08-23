"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  AlertTriangle,
  CalendarCheck2,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  MapPin,
  Plus,
  RefreshCw,
  Search,
  TriangleAlert,
  UserRoundCheck,
  UsersRound,
  XCircle,
} from "lucide-react";
import { useBdb } from "@/lib/store";
import { formatDate } from "@/lib/format";
import {
  enqueueAppointmentCommand,
  failAppointmentCommand,
  flushAppointmentQueue,
  readAppointmentQueue,
  removeAppointmentCommand,
  submitAppointmentCommand,
  writeAppointmentQueue,
  type AppointmentCommandAction,
  type AppointmentQueuedCommand,
} from "@/lib/modules/appointment-queue";
import { Badge, Button, Card, Dialog, PageHeader, StatCard } from "@/components/ui";
import styles from "./calendar.module.css";

type AppointmentStatus = "pending" | "confirmed" | "completed" | "cancelled";
type AppointmentFilter = "all" | AppointmentStatus;
type AppointmentChannel = "staff" | "phone" | "walk_in" | "online";

type AppointmentRow = {
  id: string;
  workspace_id?: string;
  reference: string;
  customer_id: string;
  customer_name_snapshot: string | null;
  service_id: string | null;
  service_code_snapshot: string | null;
  title: string;
  booking_date: string;
  booking_time: string;
  duration_minutes: number;
  preparation_buffer_minutes: number;
  recovery_buffer_minutes: number;
  staff_user_id: string | null;
  staff_name: string;
  status: AppointmentStatus;
  channel: AppointmentChannel;
  room_name: string | null;
  price_snapshot: number | null;
  vat_rate_snapshot: number;
  timezone: string;
  notes: string | null;
  cancellation_reason: string | null;
  version: number;
  cancelled_at?: string | null;
  completed_at?: string | null;
  pending?: boolean;
};

type CustomerOption = { id: string; code: string; name: string; status: "active" };
type ServiceOption = {
  id: string;
  code: string;
  name: string;
  duration_minutes: number;
  preparation_buffer_minutes: number;
  recovery_buffer_minutes: number;
  price: number | null;
  vat_rate: number;
  booking_mode: "customer" | "staff";
  status: "active";
};
type StaffOption = { user_id: string; name: string; role: string; access_profile: string };
type AppointmentBundle = {
  appointments: AppointmentRow[];
  customers: CustomerOption[];
  services: ServiceOption[];
  staff: StaffOption[];
};
type AppointmentForm = {
  customerId: string;
  serviceId: string;
  staffUserId: string;
  bookingDate: string;
  bookingTime: string;
  channel: AppointmentChannel;
  roomName: string;
  notes: string;
  initialStatus: "pending" | "confirmed";
};

const CACHE_PREFIX = "bdb-appointments-cache-v1";
const LAST_WORKSPACE_KEY = "bdb-appointments-last-workspace-v1";
const emptyBundle: AppointmentBundle = { appointments: [], customers: [], services: [], staff: [] };

const statusTone: Record<AppointmentStatus, "green" | "gold" | "blue" | "red"> = {
  pending: "gold",
  confirmed: "green",
  completed: "blue",
  cancelled: "red",
};

const statusLabel: Record<AppointmentStatus, string> = {
  pending: "Pending",
  confirmed: "Confirmed",
  completed: "Completed",
  cancelled: "Cancelled",
};

const channelLabel: Record<AppointmentChannel, string> = {
  staff: "Staff booked",
  phone: "Phone",
  walk_in: "Walk-in",
  online: "Online",
};

function dateKey(date: Date) {
  return date.toLocaleDateString("en-CA");
}

function shiftDate(value: string, days: number) {
  const next = new Date(`${value}T12:00:00`);
  next.setDate(next.getDate() + days);
  return dateKey(next);
}

function normaliseTime(value: string) {
  return value.slice(0, 5);
}

function addMinutes(value: string, minutes: number) {
  const [hours, minute] = normaliseTime(value).split(":").map(Number);
  const total = hours * 60 + minute + minutes;
  const safe = ((total % 1440) + 1440) % 1440;
  return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
}

function cacheKey(workspaceId: string) {
  return `${CACHE_PREFIX}:${workspaceId}`;
}

function readLastWorkspace() {
  return typeof window === "undefined" ? null : window.localStorage.getItem(LAST_WORKSPACE_KEY);
}

function rememberWorkspace(workspaceId: string) {
  if (typeof window !== "undefined") window.localStorage.setItem(LAST_WORKSPACE_KEY, workspaceId);
}

function readCache(workspaceId: string): AppointmentBundle {
  if (typeof window === "undefined") return emptyBundle;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(cacheKey(workspaceId)) ?? "null") as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return emptyBundle;
    const bundle = parsed as Partial<AppointmentBundle>;
    return {
      appointments: Array.isArray(bundle.appointments) ? bundle.appointments : [],
      customers: Array.isArray(bundle.customers) ? bundle.customers : [],
      services: Array.isArray(bundle.services) ? bundle.services : [],
      staff: Array.isArray(bundle.staff) ? bundle.staff : [],
    };
  } catch {
    window.localStorage.removeItem(cacheKey(workspaceId));
    return emptyBundle;
  }
}

function writeCache(workspaceId: string, bundle: AppointmentBundle) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(cacheKey(workspaceId), JSON.stringify({
    ...bundle,
    appointments: bundle.appointments.map((appointment) => {
      const cachedAppointment = { ...appointment };
      delete cachedAppointment.pending;
      return cachedAppointment;
    }),
  }));
}

function defaultForm(today: string): AppointmentForm {
  return {
    customerId: "",
    serviceId: "",
    staffUserId: "",
    bookingDate: today,
    bookingTime: "09:00",
    channel: "staff",
    roomName: "",
    notes: "",
    initialStatus: "confirmed",
  };
}

function formValues(appointment: AppointmentRow): AppointmentForm {
  return {
    customerId: appointment.customer_id,
    serviceId: appointment.service_id ?? "",
    staffUserId: appointment.staff_user_id ?? "",
    bookingDate: appointment.booking_date,
    bookingTime: normaliseTime(appointment.booking_time),
    channel: appointment.channel,
    roomName: appointment.room_name ?? "",
    notes: appointment.notes ?? "",
    initialStatus: appointment.status === "pending" ? "pending" : "confirmed",
  };
}

function provisionalAppointment(
  payload: Record<string, unknown>,
  bundle: AppointmentBundle,
): AppointmentRow {
  const id = String(payload.id);
  const customer = bundle.customers.find((item) => item.id === String(payload.customerId));
  const service = bundle.services.find((item) => item.id === String(payload.serviceId));
  const staff = bundle.staff.find((item) => item.user_id === String(payload.staffUserId));
  return {
    id,
    reference: `APT-${id.replaceAll("-", "").slice(-16).toUpperCase()}`,
    customer_id: String(payload.customerId),
    customer_name_snapshot: customer?.name ?? "Customer",
    service_id: String(payload.serviceId),
    service_code_snapshot: service?.code ?? null,
    title: service?.name ?? "Appointment",
    booking_date: String(payload.bookingDate),
    booking_time: String(payload.bookingTime),
    duration_minutes: service?.duration_minutes ?? 60,
    preparation_buffer_minutes: service?.preparation_buffer_minutes ?? 0,
    recovery_buffer_minutes: service?.recovery_buffer_minutes ?? 0,
    staff_user_id: String(payload.staffUserId),
    staff_name: staff?.name ?? "Workspace staff member",
    status: String(payload.initialStatus ?? "pending") as AppointmentStatus,
    channel: String(payload.channel ?? "staff") as AppointmentChannel,
    room_name: payload.roomName ? String(payload.roomName) : null,
    price_snapshot: service?.price ?? null,
    vat_rate_snapshot: service?.vat_rate ?? 0,
    timezone: "Europe/Malta",
    notes: payload.notes ? String(payload.notes) : null,
    cancellation_reason: null,
    version: 1,
    pending: true,
  };
}

function applyCommand(
  appointments: readonly AppointmentRow[],
  command: AppointmentQueuedCommand,
  bundle: AppointmentBundle,
): AppointmentRow[] {
  const id = String(command.payload.id);
  if (command.action === "create") {
    return appointments.some((appointment) => appointment.id === id)
      ? [...appointments]
      : [...appointments, provisionalAppointment(command.payload, bundle)];
  }

  return appointments.map((appointment) => {
    if (appointment.id !== id) return appointment;
    const nextVersion = Number(command.payload.expectedVersion ?? appointment.version) + 1;
    if (command.action === "update") {
      const provisional = provisionalAppointment(command.payload, bundle);
      return {
        ...appointment,
        ...provisional,
        id: appointment.id,
        reference: appointment.reference,
        status: appointment.status,
        version: nextVersion,
        pending: true,
      };
    }
    if (command.action === "confirm") {
      return { ...appointment, status: "confirmed", version: nextVersion, pending: true };
    }
    if (command.action === "cancel") {
      return {
        ...appointment,
        status: "cancelled",
        cancellation_reason: String(command.payload.cancellationReason ?? "Cancelled"),
        version: nextVersion,
        pending: true,
      };
    }
    return { ...appointment, status: "completed", version: nextVersion, pending: true };
  });
}

export default function CalendarPage() {
  const { state, mode } = useBdb();
  const [currentMoment] = useState(() => new Date());
  const today = dateKey(currentMoment);
  const [bundle, setBundle] = useState<AppointmentBundle>(emptyBundle);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [online, setOnline] = useState(true);
  const [selectedDate, setSelectedDate] = useState(today);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<AppointmentFilter>("all");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<AppointmentRow | null>(null);
  const [form, setForm] = useState<AppointmentForm>(() => defaultForm(today));
  const [selectedAppointment, setSelectedAppointment] = useState<AppointmentRow | null>(null);
  const [cancelTarget, setCancelTarget] = useState<AppointmentRow | null>(null);
  const [cancellationReason, setCancellationReason] = useState("");
  const [pendingCount, setPendingCount] = useState(0);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [supportReadOnly, setSupportReadOnly] = useState(false);
  const syncInFlight = useRef(false);

  const currency = useMemo(
    () => new Intl.NumberFormat("en-GB", { style: "currency", currency: state.settings.currency }),
    [state.settings.currency],
  );

  const applyQueued = useCallback((cloudBundle: AppointmentBundle, queue: AppointmentQueuedCommand[]) => {
    const appointments = queue.reduce(
      (current, command) => applyCommand(current, command, cloudBundle),
      cloudBundle.appointments,
    );
    return { ...cloudBundle, appointments };
  }, []);

  const loadCloud = useCallback(async () => {
    const contextResponse = await fetch("/api/workspace/context", { cache: "no-store" });
    const context = await contextResponse.json().catch(() => ({}));
    if (!contextResponse.ok || !context.currentWorkspaceId) {
      throw new Error(context.error ?? "The current workspace could not be resolved.");
    }

    const currentWorkspaceId = String(context.currentWorkspaceId);
    setWorkspaceId(currentWorkspaceId);
    rememberWorkspace(currentWorkspaceId);
    setSupportReadOnly(Boolean(context.supportAccess && context.supportAccessMode !== "test_write"));

    const response = await fetch(`/api/appointments?workspaceId=${encodeURIComponent(currentWorkspaceId)}`, { cache: "no-store" });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.ok) throw new Error(result.error ?? "Appointments could not be loaded.");

    const cloudBundle: AppointmentBundle = {
      appointments: (result.result?.appointments ?? []) as AppointmentRow[],
      customers: (result.result?.customers ?? []) as CustomerOption[],
      services: (result.result?.services ?? []) as ServiceOption[],
      staff: (result.result?.staff ?? []) as StaffOption[],
    };
    writeCache(currentWorkspaceId, cloudBundle);
    const queue = readAppointmentQueue(currentWorkspaceId);
    setBundle(applyQueued(cloudBundle, queue));
    setPendingCount(queue.length);
  }, [applyQueued]);

  useEffect(() => {
    const updateOnline = () => setOnline(navigator.onLine);
    updateOnline();
    window.addEventListener("online", updateOnline);
    window.addEventListener("offline", updateOnline);
    return () => {
      window.removeEventListener("online", updateOnline);
      window.removeEventListener("offline", updateOnline);
    };
  }, []);

  useEffect(() => {
    let active = true;
    async function initialise() {
      const fallbackWorkspace = mode === "demo" ? "demo" : readLastWorkspace();
      const cached = fallbackWorkspace ? readCache(fallbackWorkspace) : emptyBundle;
      const queued = fallbackWorkspace ? readAppointmentQueue(fallbackWorkspace) : [];
      if (active && fallbackWorkspace) {
        setWorkspaceId(fallbackWorkspace);
        setBundle(applyQueued(cached, queued));
        setPendingCount(queued.length);
      }

      try {
        setError("");
        if (mode === "demo") return;
        if (!navigator.onLine) {
          if (cached.appointments.length || cached.customers.length || queued.length) {
            setNotice("Showing the last cached Calendar. Appointment changes remain queued until the connection returns.");
          } else {
            setError("Calendar needs one successful online load before this workspace can open from a cold offline start.");
          }
          return;
        }
        await loadCloud();
      } catch (initialError) {
        const message = initialError instanceof Error ? initialError.message : "Appointments could not be loaded.";
        if (cached.appointments.length || cached.customers.length || queued.length) {
          setNotice("Showing the last cached Calendar while cloud access is unavailable.");
        } else if (active) {
          setError(message);
        }
      } finally {
        if (active) setLoaded(true);
      }
    }
    void initialise();
    return () => { active = false; };
  }, [applyQueued, loadCloud, mode]);

  useEffect(() => {
    if (mode === "demo" && loaded) writeCache("demo", bundle);
  }, [bundle, loaded, mode]);

  const syncPending = useCallback(async () => {
    if (!workspaceId || workspaceId === "demo" || syncInFlight.current) return;
    syncInFlight.current = true;
    setSyncing(true);
    setError("");
    try {
      const result = await flushAppointmentQueue(workspaceId, setPendingCount);
      setPendingCount(result.remaining);
      if (result.completed) {
        setNotice(`${result.completed} queued Appointment change${result.completed === 1 ? "" : "s"} synced.`);
      }
      await loadCloud();
      if (result.remaining > 0) {
        const first = readAppointmentQueue(workspaceId)[0];
        setError(first?.lastError
          ? `${first.lastError} Synchronisation stopped so the remaining Appointment changes can be reviewed.`
          : "Appointment synchronisation stopped before all changes were completed.");
      }
    } finally {
      syncInFlight.current = false;
      setSyncing(false);
    }
  }, [loadCloud, workspaceId]);

  useEffect(() => {
    if (mode === "cloud" && online && pendingCount > 0 && !syncInFlight.current) {
      void syncPending();
    }
  }, [mode, online, pendingCount, syncPending]);

  const submitCommand = useCallback(async (
    action: AppointmentCommandAction,
    payload: Record<string, unknown>,
  ) => {
    setError("");
    setNotice("");
    const command: AppointmentQueuedCommand = {
      id: crypto.randomUUID(),
      workspaceId: workspaceId ?? "demo",
      action,
      payload,
      createdAt: new Date().toISOString(),
      attempts: 0,
    };

    setBundle((current) => ({
      ...current,
      appointments: applyCommand(current.appointments, command, current),
    }));

    if (mode === "demo") {
      setNotice("Saved in this browser's local BDB OS preview.");
      return true;
    }
    if (!workspaceId) {
      setError("The current workspace is unavailable.");
      return false;
    }

    enqueueAppointmentCommand(workspaceId, action, payload, command.id);
    setPendingCount(readAppointmentQueue(workspaceId).length);
    if (!navigator.onLine) {
      setNotice("Saved offline. BDB OS will retry this Appointment change when the connection returns.");
      return true;
    }

    try {
      await submitAppointmentCommand(command);
      removeAppointmentCommand(workspaceId, command.id);
      setPendingCount(readAppointmentQueue(workspaceId).length);
      await loadCloud();
      setNotice(
        action === "create" ? "Appointment created."
          : action === "update" ? "Appointment rescheduled."
            : action === "confirm" ? "Appointment confirmed."
              : action === "cancel" ? "Appointment cancelled."
                : "Appointment completed.",
      );
      return true;
    } catch (commandError) {
      const message = commandError instanceof Error ? commandError.message : "Appointment change could not be saved.";
      failAppointmentCommand(workspaceId, command.id, message);
      setPendingCount(readAppointmentQueue(workspaceId).length);
      setError(`${message} The command remains in the local review queue; later commands will not overtake it.`);
      return false;
    }
  }, [loadCloud, mode, workspaceId]);

  const visibleAppointments = useMemo(() => {
    const term = query.trim().toLowerCase();
    return bundle.appointments
      .filter((appointment) => appointment.booking_date === selectedDate)
      .filter((appointment) => {
        const matchesQuery = !term || [
          appointment.reference,
          appointment.customer_name_snapshot,
          appointment.title,
          appointment.service_code_snapshot,
          appointment.staff_name,
          appointment.room_name,
          channelLabel[appointment.channel],
        ].join(" ").toLowerCase().includes(term);
        const matchesFilter = filter === "all" || appointment.status === filter;
        return matchesQuery && matchesFilter;
      })
      .sort((left, right) => normaliseTime(left.booking_time).localeCompare(normaliseTime(right.booking_time)));
  }, [bundle.appointments, filter, query, selectedDate]);

  const todayAppointments = bundle.appointments.filter((appointment) => appointment.booking_date === today);
  const confirmedToday = todayAppointments.filter((appointment) => appointment.status === "confirmed").length;
  const attentionToday = todayAppointments.filter((appointment) => appointment.status === "pending").length;
  const bookedMinutes = todayAppointments
    .filter((appointment) => appointment.status !== "cancelled")
    .reduce((total, appointment) => total + appointment.duration_minutes, 0);
  const bookedHours = `${Math.floor(bookedMinutes / 60)}h ${String(bookedMinutes % 60).padStart(2, "0")}m`;
  const selectedService = bundle.services.find((service) => service.id === form.serviceId) ?? null;

  function openCreate() {
    setEditing(null);
    setForm({
      ...defaultForm(selectedDate),
      customerId: bundle.customers[0]?.id ?? "",
      serviceId: bundle.services[0]?.id ?? "",
      staffUserId: bundle.staff[0]?.user_id ?? "",
    });
    setFormOpen(true);
  }

  function openEdit(appointment: AppointmentRow) {
    setEditing(appointment);
    setForm(formValues(appointment));
    setSelectedAppointment(null);
    setFormOpen(true);
  }

  async function saveAppointment(event: FormEvent) {
    event.preventDefault();
    if (saving || supportReadOnly) return;
    setSaving(true);
    const id = editing?.id ?? crypto.randomUUID();
    const ok = await submitCommand(editing ? "update" : "create", {
      id,
      expectedVersion: editing?.version,
      customerId: form.customerId,
      serviceId: form.serviceId,
      staffUserId: form.staffUserId,
      bookingDate: form.bookingDate,
      bookingTime: form.bookingTime,
      channel: form.channel,
      roomName: form.roomName,
      notes: form.notes,
      initialStatus: form.initialStatus,
    });
    setSaving(false);
    if (!ok) return;
    setSelectedDate(form.bookingDate);
    setFormOpen(false);
    setEditing(null);
  }

  async function transition(appointment: AppointmentRow, action: "confirm" | "complete") {
    if (saving || supportReadOnly || appointment.pending) return;
    setSaving(true);
    const ok = await submitCommand(action, {
      id: appointment.id,
      expectedVersion: appointment.version,
    });
    setSaving(false);
    if (ok) setSelectedAppointment(null);
  }

  async function cancelAppointment(event: FormEvent) {
    event.preventDefault();
    if (!cancelTarget || saving || supportReadOnly) return;
    setSaving(true);
    const ok = await submitCommand("cancel", {
      id: cancelTarget.id,
      expectedVersion: cancelTarget.version,
      cancellationReason,
    });
    setSaving(false);
    if (!ok) return;
    setCancelTarget(null);
    setCancellationReason("");
    setSelectedAppointment(null);
  }

  function discardQueue() {
    if (!workspaceId || workspaceId === "demo") return;
    writeAppointmentQueue(workspaceId, []);
    setPendingCount(0);
    void loadCloud();
    setNotice("Pending local Appointment changes were discarded.");
  }

  if (!loaded) {
    return <main className="admin-loading"><RefreshCw className="spin" size={20} /> Loading Calendar…</main>;
  }

  const canCreate = bundle.customers.length > 0 && bundle.services.length > 0 && bundle.staff.length > 0;

  return (
    <>
      <PageHeader
        eyebrow="Scheduling and appointments"
        title="Calendar"
        description="Create and manage Customer Appointments using authoritative Customer, Service and staff records."
        action={(
          <div className={styles.headerActions}>
            <Button variant="secondary" onClick={() => void syncPending()} disabled={mode !== "cloud" || syncing || !online}>
              <RefreshCw className={syncing ? "spin" : ""} size={17} /> {syncing ? "Syncing…" : "Refresh"}
            </Button>
            <Button onClick={openCreate} disabled={supportReadOnly || !canCreate}>
              <Plus size={17} /> New appointment
            </Button>
          </div>
        )}
      />

      <div className="review-callout">
        <CalendarCheck2 size={19} />
        <div>
          <strong>Authoritative Appointment foundation</strong>
          <p>Customer, Service, staff, timing, buffers and lifecycle are connected. This slice blocks overlapping staff time. Working hours, leave, rooms and staff-to-Service eligibility remain the next Calendar integration.</p>
        </div>
      </div>

      {supportReadOnly ? (
        <div className={styles.supportNotice}>
          <CalendarDays size={18} />
          <div><strong>Read-only access</strong><span>Appointment changes remain blocked during this session.</span></div>
        </div>
      ) : null}

      {!online ? (
        <Card className="settings-note"><strong>Offline</strong><p>Cached Calendar data remains available. Supported Appointment changes are queued in order and replayed once.</p></Card>
      ) : null}
      {error ? (
        <Card className="settings-note"><strong>Action needed</strong><p>{error}</p></Card>
      ) : null}
      {notice ? <div className="toast"><CheckCircle2 size={17} /> {notice}</div> : null}
      {pendingCount > 0 ? (
        <Card className="settings-note">
          <strong>{pendingCount} local Appointment change{pendingCount === 1 ? "" : "s"} awaiting completion</strong>
          <p>Commands remain ordered. Synchronisation stops at the first validation or conflict error.</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
            <Button variant="secondary" onClick={() => void syncPending()} disabled={!online || syncing}>Retry sync</Button>
            <Button variant="quiet" onClick={discardQueue} disabled={syncing}>Discard local queue</Button>
          </div>
        </Card>
      ) : null}

      {!canCreate ? (
        <Card className="settings-note">
          <strong>Connected records required</strong>
          <p>Create at least one active Customer and Service, and keep one active workspace staff member, before creating an Appointment.</p>
        </Card>
      ) : null}

      <div className="stat-grid">
        <StatCard label="Today" value={String(todayAppointments.length)} detail="Authoritative Appointments" icon={<CalendarDays size={19} />} />
        <StatCard label="Confirmed" value={String(confirmedToday)} detail="Ready for service" icon={<CalendarCheck2 size={19} />} />
        <StatCard label="Scheduled time" value={bookedHours} detail="Excluding cancellations" icon={<Clock3 size={19} />} />
        <StatCard label="Needs attention" value={String(attentionToday)} detail="Pending confirmation" icon={<AlertTriangle size={19} />} />
      </div>

      <div className={styles.calendarLayout}>
        <Card className={styles.scheduleCard}>
          <div className={styles.toolbar}>
            <label className={styles.searchField}>
              <Search size={17} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search Customer, Service, staff, room or reference…"
                aria-label="Search appointments"
              />
            </label>
            <div className={styles.dateControls} aria-label="Calendar date controls">
              <button type="button" onClick={() => setSelectedDate((value) => shiftDate(value, -1))} aria-label="Previous day"><ChevronLeft size={17} /></button>
              <button type="button" className={styles.todayButton} onClick={() => setSelectedDate(today)}>Today</button>
              <button type="button" onClick={() => setSelectedDate((value) => shiftDate(value, 1))} aria-label="Next day"><ChevronRight size={17} /></button>
            </div>
          </div>

          <div className={styles.scheduleHeader}>
            <div>
              <p className="eyebrow">Day agenda</p>
              <h2>{formatDate(selectedDate, { weekday: "long", day: "numeric", month: "long" })}</h2>
            </div>
            <div className={styles.scheduleMeta}>
              <Badge tone="neutral">{visibleAppointments.length} visible</Badge>
              <Badge tone={pendingCount > 0 ? "gold" : "green"}>{pendingCount > 0 ? `${pendingCount} queued` : "Synced"}</Badge>
            </div>
          </div>

          <div className={styles.filters} aria-label="Appointment filters">
            {(["all", "pending", "confirmed", "completed", "cancelled"] as AppointmentFilter[]).map((item) => (
              <button
                key={item}
                type="button"
                className={filter === item ? styles.activeFilter : ""}
                onClick={() => setFilter(item)}
              >
                {item === "all" ? "All" : statusLabel[item]}
              </button>
            ))}
          </div>

          {visibleAppointments.length > 0 ? (
            <div className={styles.timeline}>
              {visibleAppointments.map((appointment) => (
                <button
                  key={appointment.id}
                  type="button"
                  className={styles.appointmentButton}
                  onClick={() => setSelectedAppointment(appointment)}
                >
                  <span className={styles.appointmentTime}>
                    <strong>{normaliseTime(appointment.booking_time)}</strong>
                    <span>{addMinutes(appointment.booking_time, appointment.duration_minutes)}</span>
                  </span>
                  <span className={styles.appointmentMain}>
                    <strong>{appointment.customer_name_snapshot || "Customer"} · {appointment.title}</strong>
                    <span className={styles.appointmentMeta}>
                      <span><UserRoundCheck size={14} /> {appointment.staff_name}</span>
                      {appointment.room_name ? <span><MapPin size={14} /> {appointment.room_name}</span> : null}
                      <span><Clock3 size={14} /> {appointment.duration_minutes} min</span>
                    </span>
                  </span>
                  <span className={styles.appointmentSide}>
                    <Badge tone={statusTone[appointment.status]}>{statusLabel[appointment.status]}</Badge>
                    {appointment.pending ? <Badge tone="gold">Local</Badge> : null}
                    <span className={styles.appointmentPrice}>{appointment.price_snapshot === null ? "No set price" : currency.format(appointment.price_snapshot)}</span>
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className={styles.emptyState}>
              <CalendarDays size={25} />
              <h3>No Appointments match</h3>
              <p>Change the date, search term or status filter, or create a new Appointment.</p>
            </div>
          )}
        </Card>

        <div className={styles.sideColumn}>
          <Card className={styles.guidanceCard}>
            <div className={styles.guidanceIcon}><UsersRound size={20} /></div>
            <p className="eyebrow">Connected records</p>
            <h2>One Customer, Service and staff identity</h2>
            <p className="muted small">Appointments reference canonical records and retain historical Customer, Service timing and price snapshots.</p>
          </Card>
          <Card className={styles.guidanceCard}>
            <div className={styles.guidanceIcon}><TriangleAlert size={20} /></div>
            <p className="eyebrow">Current conflict guard</p>
            <h2>Staff overlap is blocked</h2>
            <p className="muted small">Preparation, Service duration and recovery buffers are checked atomically. Working hours, leave, rooms and eligibility are not yet availability promises.</p>
          </Card>
          <Card className={styles.guidanceCard}>
            <div className={styles.guidanceIcon}><CheckCircle2 size={20} /></div>
            <p className="eyebrow">Department boundary</p>
            <h2>Completion records the Appointment only</h2>
            <p className="muted small">No Sale, invoice, Payment or Inventory movement is created until its owning department is deliberately connected.</p>
          </Card>
        </div>
      </div>

      <Dialog
        open={selectedAppointment !== null}
        onClose={() => setSelectedAppointment(null)}
        title={selectedAppointment ? `${selectedAppointment.customer_name_snapshot || "Customer"} · ${selectedAppointment.title}` : "Appointment"}
        description="Authoritative Appointment detail and lifecycle actions."
        className={styles.appointmentDialog}
      >
        {selectedAppointment ? (
          <div className={styles.dialogBody}>
            <div className={styles.detailHero}>
              <div>
                <p className="eyebrow">{selectedAppointment.reference}</p>
                <h3>{formatDate(selectedAppointment.booking_date, { weekday: "long", day: "numeric", month: "long" })}</h3>
                <p className="muted">{normaliseTime(selectedAppointment.booking_time)}–{addMinutes(selectedAppointment.booking_time, selectedAppointment.duration_minutes)} · {selectedAppointment.timezone}</p>
              </div>
              <Badge tone={statusTone[selectedAppointment.status]}>{statusLabel[selectedAppointment.status]}</Badge>
            </div>

            <div className={styles.detailGrid}>
              <div className={styles.detailPanel}>
                <h3>Appointment</h3>
                <div className={styles.detailList}>
                  <div className={styles.detailRow}><span>Customer</span><strong>{selectedAppointment.customer_name_snapshot || "Customer"}</strong></div>
                  <div className={styles.detailRow}><span>Service</span><strong>{selectedAppointment.title}</strong></div>
                  <div className={styles.detailRow}><span>Staff member</span><strong>{selectedAppointment.staff_name}</strong></div>
                  <div className={styles.detailRow}><span>Booking source</span><span>{channelLabel[selectedAppointment.channel]}</span></div>
                  <div className={styles.detailRow}><span>Room label</span><span>{selectedAppointment.room_name || "Not assigned"}</span></div>
                </div>
              </div>
              <div className={styles.detailPanel}>
                <h3>Timing snapshot</h3>
                <div className={styles.detailList}>
                  <div className={styles.detailRow}><span>Service duration</span><strong>{selectedAppointment.duration_minutes} min</strong></div>
                  <div className={styles.detailRow}><span>Preparation</span><span>{selectedAppointment.preparation_buffer_minutes} min</span></div>
                  <div className={styles.detailRow}><span>Recovery</span><span>{selectedAppointment.recovery_buffer_minutes} min</span></div>
                  <div className={styles.detailRow}><span>Effective occupied time</span><span>{selectedAppointment.duration_minutes + selectedAppointment.preparation_buffer_minutes + selectedAppointment.recovery_buffer_minutes} min</span></div>
                  <div className={styles.detailRow}><span>Service value</span><strong>{selectedAppointment.price_snapshot === null ? "No set price" : currency.format(selectedAppointment.price_snapshot)}</strong></div>
                </div>
              </div>
            </div>

            <div className={styles.notesGrid}>
              <div className={styles.noteCard}><h3>Appointment notes</h3><p>{selectedAppointment.notes || "No Appointment notes recorded."}</p></div>
              <div className={styles.noteCard}><h3>Lifecycle</h3><p>Version {selectedAppointment.version}. {selectedAppointment.cancellation_reason ? `Cancellation: ${selectedAppointment.cancellation_reason}` : "Every successful status change is recorded in Activity."}</p></div>
            </div>

            <div className="dialog-actions">
              <Button type="button" variant="quiet" onClick={() => setSelectedAppointment(null)}>Close</Button>
              {(["pending", "confirmed"] as AppointmentStatus[]).includes(selectedAppointment.status) ? (
                <Button type="button" variant="secondary" onClick={() => openEdit(selectedAppointment)} disabled={supportReadOnly || selectedAppointment.pending}>Reschedule</Button>
              ) : null}
              {selectedAppointment.status === "pending" ? (
                <Button type="button" onClick={() => void transition(selectedAppointment, "confirm")} disabled={supportReadOnly || saving || selectedAppointment.pending}>Confirm</Button>
              ) : null}
              {selectedAppointment.status === "confirmed" ? (
                <Button type="button" onClick={() => void transition(selectedAppointment, "complete")} disabled={supportReadOnly || saving || selectedAppointment.pending}>Complete</Button>
              ) : null}
              {(["pending", "confirmed"] as AppointmentStatus[]).includes(selectedAppointment.status) ? (
                <Button type="button" variant="danger" onClick={() => { setCancelTarget(selectedAppointment); setCancellationReason(""); }} disabled={supportReadOnly || saving || selectedAppointment.pending}>Cancel</Button>
              ) : null}
            </div>
          </div>
        ) : null}
      </Dialog>

      <Dialog
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? "Reschedule appointment" : "New appointment"}
        description="Customer, Service, staff and timing are saved through one trusted Appointment command."
        className={styles.newAppointmentDialog}
      >
        <form onSubmit={(event) => void saveAppointment(event)}>
          <div className={styles.formBody}>
            <div className={styles.formGrid}>
              <label className={styles.wide}>Customer
                <select required value={form.customerId} onChange={(event) => setForm((current) => ({ ...current, customerId: event.target.value }))} disabled={saving || supportReadOnly}>
                  <option value="">Choose Customer</option>
                  {bundle.customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name} · {customer.code}</option>)}
                </select>
              </label>
              <label>Booking source
                <select value={form.channel} onChange={(event) => setForm((current) => ({ ...current, channel: event.target.value as AppointmentChannel }))} disabled={saving || supportReadOnly}>
                  <option value="staff">Staff booked</option>
                  <option value="phone">Phone</option>
                  <option value="walk_in">Walk-in</option>
                  <option value="online">Online</option>
                </select>
              </label>
              <label className={styles.wide}>Service
                <select required value={form.serviceId} onChange={(event) => setForm((current) => ({ ...current, serviceId: event.target.value }))} disabled={saving || supportReadOnly}>
                  <option value="">Choose Service</option>
                  {bundle.services.map((service) => <option key={service.id} value={service.id}>{service.name} · {service.code}</option>)}
                </select>
              </label>
              <label>Staff member
                <select required value={form.staffUserId} onChange={(event) => setForm((current) => ({ ...current, staffUserId: event.target.value }))} disabled={saving || supportReadOnly}>
                  <option value="">Choose staff</option>
                  {bundle.staff.map((member) => <option key={member.user_id} value={member.user_id}>{member.name}</option>)}
                </select>
              </label>
              <label>Date<input required type="date" value={form.bookingDate} onChange={(event) => setForm((current) => ({ ...current, bookingDate: event.target.value }))} disabled={saving || supportReadOnly} /></label>
              <label>Start time<input required type="time" value={form.bookingTime} onChange={(event) => setForm((current) => ({ ...current, bookingTime: event.target.value }))} disabled={saving || supportReadOnly} /></label>
              <label>Room label<input value={form.roomName} maxLength={120} placeholder="Optional until Resources is integrated" onChange={(event) => setForm((current) => ({ ...current, roomName: event.target.value }))} disabled={saving || supportReadOnly} /></label>
              {!editing ? (
                <label>Initial status
                  <select value={form.initialStatus} onChange={(event) => setForm((current) => ({ ...current, initialStatus: event.target.value as "pending" | "confirmed" }))} disabled={saving || supportReadOnly}>
                    <option value="confirmed">Confirmed</option>
                    <option value="pending">Pending confirmation</option>
                  </select>
                </label>
              ) : null}
              <label className={styles.full}>Appointment notes<textarea rows={3} value={form.notes} maxLength={4000} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} disabled={saving || supportReadOnly} /></label>
            </div>

            <div className={styles.formSplit}>
              <div className={styles.formSection}>
                <h3>Service snapshot</h3>
                <div className={styles.servicePreview}>
                  <div className={styles.servicePreviewRow}><span>Service duration</span><strong>{selectedService?.duration_minutes ?? 0} minutes</strong></div>
                  <div className={styles.servicePreviewRow}><span>Preparation buffer</span><strong>{selectedService?.preparation_buffer_minutes ?? 0} minutes</strong></div>
                  <div className={styles.servicePreviewRow}><span>Recovery buffer</span><strong>{selectedService?.recovery_buffer_minutes ?? 0} minutes</strong></div>
                  <div className={styles.servicePreviewRow}><span>Service value</span><strong>{selectedService?.price === null || selectedService?.price === undefined ? "No set price" : currency.format(selectedService.price)}</strong></div>
                </div>
              </div>
              <div className={styles.formSection}>
                <h3>Conflict boundary</h3>
                <div className={styles.conflictPanel}>
                  <AlertTriangle size={18} />
                  <div><strong>Staff overlap will be checked</strong><span>Working hours, leave, room availability and Service eligibility remain unverified until their dedicated integration.</span></div>
                </div>
              </div>
            </div>
          </div>
          <div className="dialog-actions">
            <Button type="button" variant="quiet" onClick={() => setFormOpen(false)} disabled={saving}>Close</Button>
            <Button type="submit" disabled={saving || supportReadOnly || !form.customerId || !form.serviceId || !form.staffUserId}>
              {saving ? "Saving…" : editing ? "Save reschedule" : online ? "Create appointment" : "Save offline"}
            </Button>
          </div>
        </form>
      </Dialog>

      <Dialog
        open={cancelTarget !== null}
        onClose={() => setCancelTarget(null)}
        title="Cancel appointment"
        description="The original Appointment remains in history and its occupied staff time is released."
      >
        <form onSubmit={(event) => void cancelAppointment(event)}>
          <div className={styles.formBody}>
            <label className={styles.full} style={{ display: "grid", gap: 8 }}>
              Cancellation reason
              <textarea required minLength={2} maxLength={500} rows={4} value={cancellationReason} onChange={(event) => setCancellationReason(event.target.value)} disabled={saving || supportReadOnly} />
            </label>
          </div>
          <div className="dialog-actions">
            <Button type="button" variant="quiet" onClick={() => setCancelTarget(null)} disabled={saving}>Keep appointment</Button>
            <Button type="submit" variant="danger" disabled={saving || supportReadOnly || cancellationReason.trim().length < 2}>
              <XCircle size={16} /> {saving ? "Cancelling…" : "Cancel appointment"}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
