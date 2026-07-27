"use client";

import { useMemo, useState } from "react";
import {
  AlertTriangle,
  CalendarCheck2,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  CreditCard,
  MapPin,
  MessageSquareText,
  PackageCheck,
  Plus,
  Search,
  Sparkles,
  UserRoundCheck,
  UsersRound,
  Wrench,
} from "lucide-react";
import { useBdb } from "@/lib/store";
import { formatDate } from "@/lib/format";
import { Badge, Button, Card, Dialog, PageHeader, StatCard } from "@/components/ui";
import styles from "./calendar.module.css";

type AppointmentStatus = "Confirmed" | "Pending" | "Completed" | "Cancelled";
type AppointmentFilter = "all" | "confirmed" | "pending" | "completed" | "cancelled";

type PreviewAppointment = {
  id: string;
  date: string;
  startTime: string;
  endTime: string;
  customer: string;
  service: string;
  staff: string;
  room: string;
  durationMinutes: number;
  preparationBuffer: number;
  recoveryBuffer: number;
  status: AppointmentStatus;
  channel: "Online" | "Phone" | "Walk-in" | "Staff booked";
  price: number;
  invoiceState: string;
  paymentState: "Paid" | "Part paid" | "Due" | "Not invoiced" | "Refunded";
  products: { name: string; quantity: number }[];
  customerNotes: string;
  staffNotes: string;
};

const statusTone: Record<AppointmentStatus, "green" | "gold" | "blue" | "red"> = {
  Confirmed: "green",
  Pending: "gold",
  Completed: "blue",
  Cancelled: "red",
};

function dateKey(date: Date) {
  return date.toLocaleDateString("en-CA");
}

function shiftDate(value: string, days: number) {
  const next = new Date(`${value}T12:00:00`);
  next.setDate(next.getDate() + days);
  return dateKey(next);
}

function buildPreviewAppointments(baseDate: string): PreviewAppointment[] {
  const previousDate = shiftDate(baseDate, -1);
  const nextDate = shiftDate(baseDate, 1);

  return [
    {
      id: "APT-2041",
      date: baseDate,
      startTime: "09:00",
      endTime: "10:15",
      customer: "Maya Grech",
      service: "Hydrating Facial Treatment",
      staff: "Vanita Workspace Owner",
      room: "Treatment room 1",
      durationMinutes: 75,
      preparationBuffer: 10,
      recoveryBuffer: 10,
      status: "Confirmed",
      channel: "Online",
      price: 82,
      invoiceState: "Draft invoice",
      paymentState: "Part paid",
      products: [
        { name: "Hydrating serum", quantity: 1 },
        { name: "Disposable facial kit", quantity: 1 },
      ],
      customerNotes: "Sensitive skin. Avoid strongly fragranced products.",
      staffNotes: "Review previous treatment response before starting.",
    },
    {
      id: "APT-2042",
      date: baseDate,
      startTime: "10:45",
      endTime: "11:45",
      customer: "Elena Zammit",
      service: "Deep Cleansing Facial",
      staff: "Senior therapist",
      room: "Treatment room 2",
      durationMinutes: 60,
      preparationBuffer: 10,
      recoveryBuffer: 10,
      status: "Pending",
      channel: "Phone",
      price: 65,
      invoiceState: "Not created",
      paymentState: "Not invoiced",
      products: [{ name: "Deep cleansing mask", quantity: 1 }],
      customerNotes: "First appointment. Consultation required before treatment.",
      staffNotes: "Confirm patch-test history during check-in.",
    },
    {
      id: "APT-2043",
      date: baseDate,
      startTime: "13:30",
      endTime: "14:00",
      customer: "Sofia Mifsud",
      service: "Consultation and Skin Review",
      staff: "Vanita Workspace Owner",
      room: "Consultation room",
      durationMinutes: 30,
      preparationBuffer: 0,
      recoveryBuffer: 0,
      status: "Confirmed",
      channel: "Staff booked",
      price: 0,
      invoiceState: "No invoice required",
      paymentState: "Not invoiced",
      products: [],
      customerNotes: "Review current skincare routine and recommend next treatment.",
      staffNotes: "Bring previous consultation notes into the appointment.",
    },
    {
      id: "APT-2044",
      date: baseDate,
      startTime: "15:00",
      endTime: "16:30",
      customer: "Rachel Borg",
      service: "Seasonal Body Treatment",
      staff: "Senior therapist",
      room: "Treatment room 1",
      durationMinutes: 90,
      preparationBuffer: 15,
      recoveryBuffer: 15,
      status: "Cancelled",
      channel: "Online",
      price: 95,
      invoiceState: "Credit note review",
      paymentState: "Refunded",
      products: [{ name: "Seasonal body treatment kit", quantity: 1 }],
      customerNotes: "Customer cancelled on the morning of the appointment.",
      staffNotes: "Do not consume stock. Cancellation policy review required.",
    },
    {
      id: "APT-2038",
      date: previousDate,
      startTime: "11:00",
      endTime: "12:00",
      customer: "Julia Caruana",
      service: "Deep Cleansing Facial",
      staff: "Vanita Workspace Owner",
      room: "Treatment room 1",
      durationMinutes: 60,
      preparationBuffer: 10,
      recoveryBuffer: 10,
      status: "Completed",
      channel: "Walk-in",
      price: 65,
      invoiceState: "INV-1058",
      paymentState: "Paid",
      products: [
        { name: "Deep cleansing mask", quantity: 1 },
        { name: "Disposable facial kit", quantity: 1 },
      ],
      customerNotes: "Walk-in customer converted to a customer profile.",
      staffNotes: "Treatment completed without reaction. Follow up in four weeks.",
    },
    {
      id: "APT-2047",
      date: nextDate,
      startTime: "09:30",
      endTime: "10:30",
      customer: "Nadia Vella",
      service: "Deep Cleansing Facial",
      staff: "Senior therapist",
      room: "Treatment room 2",
      durationMinutes: 60,
      preparationBuffer: 10,
      recoveryBuffer: 10,
      status: "Confirmed",
      channel: "Online",
      price: 65,
      invoiceState: "Not created",
      paymentState: "Due",
      products: [{ name: "Deep cleansing mask", quantity: 1 }],
      customerNotes: "Prefers a morning appointment.",
      staffNotes: "Check treatment-room stock before opening.",
    },
  ];
}

export default function CalendarPage() {
  const { state, role } = useBdb();
  const [currentMoment] = useState(() => new Date());
  const today = dateKey(currentMoment);
  const [selectedDate, setSelectedDate] = useState(today);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<AppointmentFilter>("all");
  const [newAppointmentOpen, setNewAppointmentOpen] = useState(false);
  const [selectedAppointment, setSelectedAppointment] = useState<PreviewAppointment | null>(null);
  const supportMode = role === "platform-support";

  const appointments = useMemo(() => buildPreviewAppointments(today), [today]);
  const currency = useMemo(
    () => new Intl.NumberFormat("en-GB", { style: "currency", currency: state.settings.currency }),
    [state.settings.currency],
  );

  const selectedDayAppointments = useMemo(() => {
    const term = query.trim().toLowerCase();
    return appointments
      .filter((appointment) => appointment.date === selectedDate)
      .filter((appointment) => {
        const matchesQuery = !term || [
          appointment.id,
          appointment.customer,
          appointment.service,
          appointment.staff,
          appointment.room,
          appointment.channel,
        ].join(" ").toLowerCase().includes(term);
        const matchesFilter = filter === "all" || appointment.status.toLowerCase() === filter;
        return matchesQuery && matchesFilter;
      })
      .sort((a, b) => a.startTime.localeCompare(b.startTime));
  }, [appointments, filter, query, selectedDate]);

  const todayAppointments = appointments.filter((appointment) => appointment.date === today);
  const confirmedToday = todayAppointments.filter((appointment) => appointment.status === "Confirmed").length;
  const attentionToday = todayAppointments.filter((appointment) => appointment.status === "Pending" || appointment.status === "Cancelled").length;
  const bookedMinutes = todayAppointments
    .filter((appointment) => appointment.status !== "Cancelled")
    .reduce((total, appointment) => total + appointment.durationMinutes, 0);
  const bookedHours = `${Math.floor(bookedMinutes / 60)}h ${String(bookedMinutes % 60).padStart(2, "0")}m`;

  return (
    <>
      <PageHeader
        eyebrow="Scheduling and appointments"
        title="Calendar"
        description="Coordinate customer appointments using shared Services, staff eligibility, availability, invoices and future Inventory consumption."
        action={(
          <div className={styles.headerActions}>
            <Button variant="secondary" disabled title="Walk-in conversion will be connected after the appointment schema is approved">
              <UsersRound size={17} /> Walk-in
            </Button>
            <Button onClick={() => setNewAppointmentOpen(true)}>
              <Plus size={17} /> New appointment
            </Button>
          </div>
        )}
      />

      <div className="review-callout">
        <Sparkles size={19} />
        <div>
          <strong>Calendar enhancement preview</strong>
          <p>Appointments below are representative design data only. The enhanced form does not create, reschedule, cancel, invoice or consume stock yet.</p>
        </div>
      </div>

      {supportMode ? (
        <div className={styles.supportNotice}>
          <CalendarDays size={18} />
          <div><strong>Founder support · Read only</strong><span>Appointment and availability changes remain blocked during the audited support session.</span></div>
        </div>
      ) : null}

      <div className="stat-grid">
        <StatCard label="Today" value={String(todayAppointments.length)} detail="Preview appointments" icon={<CalendarDays size={19} />} />
        <StatCard label="Confirmed" value={String(confirmedToday)} detail="Ready for service" icon={<CalendarCheck2 size={19} />} />
        <StatCard label="Scheduled time" value={bookedHours} detail="Excluding cancellations" icon={<Clock3 size={19} />} />
        <StatCard label="Needs attention" value={String(attentionToday)} detail="Pending or cancelled" icon={<AlertTriangle size={19} />} />
      </div>

      <div className={styles.calendarLayout}>
        <Card className={styles.scheduleCard}>
          <div className={styles.toolbar}>
            <label className={styles.searchField}>
              <Search size={17} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search customer, service, staff, room or reference…"
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
              <Badge tone="neutral">{selectedDayAppointments.length} visible</Badge>
              <Badge tone="gold">08:30–18:00 preview hours</Badge>
            </div>
          </div>

          <div className={styles.filters} aria-label="Appointment filters">
            {(["all", "confirmed", "pending", "completed", "cancelled"] as AppointmentFilter[]).map((item) => (
              <button
                key={item}
                type="button"
                className={filter === item ? styles.activeFilter : ""}
                onClick={() => setFilter(item)}
              >
                {item === "all" ? "All" : item.charAt(0).toUpperCase() + item.slice(1)}
              </button>
            ))}
          </div>

          {selectedDayAppointments.length > 0 ? (
            <div className={styles.timeline}>
              {selectedDayAppointments.map((appointment) => (
                <button
                  key={appointment.id}
                  type="button"
                  className={styles.appointmentButton}
                  onClick={() => setSelectedAppointment(appointment)}
                >
                  <span className={styles.appointmentTime}>
                    <strong>{appointment.startTime}</strong>
                    <span>{appointment.endTime}</span>
                  </span>
                  <span className={styles.appointmentMain}>
                    <strong>{appointment.customer} · {appointment.service}</strong>
                    <span className={styles.appointmentMeta}>
                      <span><UserRoundCheck size={14} /> {appointment.staff}</span>
                      <span><MapPin size={14} /> {appointment.room}</span>
                      <span><Clock3 size={14} /> {appointment.durationMinutes} min</span>
                    </span>
                  </span>
                  <span className={styles.appointmentSide}>
                    <Badge tone={statusTone[appointment.status]}>{appointment.status}</Badge>
                    <span className={styles.appointmentPrice}>{currency.format(appointment.price)}</span>
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className={styles.emptyState}>
              <CalendarDays size={25} />
              <h3>No preview appointments match</h3>
              <p>Change the date, search term or status filter.</p>
            </div>
          )}

          {selectedDate === today && attentionToday > 0 ? (
            <div className={styles.attentionBar}>
              <AlertTriangle size={18} />
              <div><strong>Manual review required</strong><span>One pending confirmation and one cancellation require staff follow-up before the day is closed.</span></div>
            </div>
          ) : null}
        </Card>

        <div className={styles.sideColumn}>
          <Card className={styles.guidanceCard}>
            <div className={styles.guidanceIcon}><UsersRound size={20} /></div>
            <p className="eyebrow">Staff availability</p>
            <h2>Eligibility before open slots</h2>
            <p className="muted small">Services define which team members may deliver the work. Calendar combines that with working hours, leave, buffers and room availability.</p>
            <div className={styles.staffList}>
              <div className={styles.staffRow}>
                <div className={styles.staffIdentity}><span className={styles.staffAvatar}>VO</span><div><strong>Vanita Workspace Owner</strong><small>3 appointments</small></div></div>
                <Badge tone="green">Available</Badge>
              </div>
              <div className={styles.staffRow}>
                <div className={styles.staffIdentity}><span className={styles.staffAvatar}>ST</span><div><strong>Senior therapist</strong><small>2 appointments</small></div></div>
                <Badge tone="gold">Review break</Badge>
              </div>
            </div>
          </Card>

          <Card className={styles.guidanceCard}>
            <div className={styles.guidanceIcon}><AlertTriangle size={20} /></div>
            <p className="eyebrow">Conflict protection</p>
            <h2>Do not invent availability</h2>
            <p className="muted small">A slot is only available when staff, room, service duration, preparation and recovery buffers all fit. Conflict detection remains unconnected in this preview.</p>
          </Card>

          <Card className={styles.guidanceCard}>
            <div className={styles.guidanceIcon}><CircleDollarSign size={20} /></div>
            <p className="eyebrow">Connected completion</p>
            <h2>One appointment, several records</h2>
            <p className="muted small">Completing an appointment may create customer history, an invoice line and Inventory consumption, but those departments remain authoritative for their own records.</p>
          </Card>
        </div>
      </div>

      <Dialog
        open={selectedAppointment !== null}
        onClose={() => setSelectedAppointment(null)}
        title={selectedAppointment ? `${selectedAppointment.customer} · ${selectedAppointment.service}` : "Appointment"}
        description="Visual appointment detail. Actions remain unavailable until the connected appointment schema is approved."
        className={styles.appointmentDialog}
      >
        {selectedAppointment ? (
          <div className={styles.dialogBody}>
            <div className={styles.detailHero}>
              <div>
                <p className="eyebrow">{selectedAppointment.id}</p>
                <h3>{formatDate(selectedAppointment.date, { weekday: "long", day: "numeric", month: "long" })}</h3>
                <p className="muted">{selectedAppointment.startTime}–{selectedAppointment.endTime} · {selectedAppointment.room}</p>
              </div>
              <Badge tone={statusTone[selectedAppointment.status]}>{selectedAppointment.status}</Badge>
            </div>

            <div className={styles.detailGrid}>
              <div className={styles.detailPanel}>
                <h3>Appointment</h3>
                <div className={styles.detailList}>
                  <div className={styles.detailRow}><span>Customer</span><strong>{selectedAppointment.customer}</strong></div>
                  <div className={styles.detailRow}><span>Service</span><strong>{selectedAppointment.service}</strong></div>
                  <div className={styles.detailRow}><span>Staff member</span><strong>{selectedAppointment.staff}</strong></div>
                  <div className={styles.detailRow}><span>Booking source</span><span>{selectedAppointment.channel}</span></div>
                  <div className={styles.detailRow}><span>Duration</span><span>{selectedAppointment.durationMinutes} min + {selectedAppointment.preparationBuffer} min prep + {selectedAppointment.recoveryBuffer} min recovery</span></div>
                </div>
              </div>

              <div className={styles.detailPanel}>
                <h3>Financial connection</h3>
                <div className={styles.detailList}>
                  <div className={styles.detailRow}><span>Service value</span><strong>{currency.format(selectedAppointment.price)}</strong></div>
                  <div className={styles.detailRow}><span>Invoice</span><span>{selectedAppointment.invoiceState}</span></div>
                  <div className={styles.detailRow}><span>Payment</span><span>{selectedAppointment.paymentState}</span></div>
                </div>
              </div>

              <div className={styles.detailPanel}>
                <h3>Planned product consumption</h3>
                {selectedAppointment.products.length ? (
                  <div className={styles.productList}>
                    {selectedAppointment.products.map((product) => (
                      <div className={styles.productItem} key={product.name}><strong>{product.name}</strong><span>Qty {product.quantity}</span></div>
                    ))}
                  </div>
                ) : <p className="muted small">No product consumption is expected for this service.</p>}
              </div>

              <div className={styles.detailPanel}>
                <h3>Workflow status</h3>
                <div className={styles.detailList}>
                  <div className={styles.detailRow}><span>Customer history</span><span>Created after completion</span></div>
                  <div className={styles.detailRow}><span>Inventory</span><span>No movement before completion</span></div>
                  <div className={styles.detailRow}><span>Activity log</span><span>Every status change audited</span></div>
                </div>
              </div>
            </div>

            <div className={styles.notesGrid}>
              <div className={styles.noteCard}><h3>Customer notes</h3><p>{selectedAppointment.customerNotes}</p></div>
              <div className={styles.noteCard}><h3>Staff notes</h3><p>{selectedAppointment.staffNotes}</p></div>
            </div>

            <div className="dialog-actions">
              <Button type="button" variant="quiet" onClick={() => setSelectedAppointment(null)}>Close preview</Button>
              <Button type="button" variant="secondary" disabled>Reschedule</Button>
              <Button type="button" variant="danger" disabled>Cancel appointment</Button>
              <Button type="button" disabled>Mark completed</Button>
            </div>
          </div>
        ) : null}
      </Dialog>

      <Dialog
        open={newAppointmentOpen}
        onClose={() => setNewAppointmentOpen(false)}
        title="New appointment"
        description="Visual preview of the connected appointment workflow. Fields do not accept or save data yet."
        className={styles.newAppointmentDialog}
      >
        <div className={styles.formBody}>
          <div className={styles.formGrid}>
            <label className={styles.wide}>Customer<select disabled defaultValue="maya"><option value="maya">Maya Grech</option></select></label>
            <label>Booking source<select disabled defaultValue="staff"><option value="staff">Staff booked</option><option value="online">Online</option><option value="phone">Phone</option><option value="walk-in">Walk-in</option></select></label>
            <label className={styles.wide}>Service<select disabled defaultValue="hydrating"><option value="hydrating">Hydrating Facial Treatment</option></select></label>
            <label>Eligible staff<select disabled defaultValue="owner"><option value="owner">Vanita Workspace Owner</option><option value="senior">Senior therapist</option></select></label>
            <label>Date<input disabled type="date" defaultValue={today} /></label>
            <label>Start time<input disabled type="time" defaultValue="09:00" /></label>
            <label>Room / resource<select disabled defaultValue="room-1"><option value="room-1">Treatment room 1</option><option value="room-2">Treatment room 2</option></select></label>
            <label>Status<select disabled defaultValue="confirmed"><option value="confirmed">Confirmed</option><option value="pending">Pending confirmation</option></select></label>
            <label>Invoice option<select disabled defaultValue="later"><option value="later">Create after appointment</option><option value="draft">Create draft now</option><option value="none">No invoice required</option></select></label>
            <label className={styles.full}>Appointment notes<textarea disabled rows={3} placeholder="Customer requests, accessibility needs or treatment notes" /></label>
          </div>

          <div className={styles.formSplit}>
            <div className={styles.formSection}>
              <h3>Service timing and price</h3>
              <div className={styles.servicePreview}>
                <div className={styles.servicePreviewRow}><span>Service duration</span><strong>75 minutes</strong></div>
                <div className={styles.servicePreviewRow}><span>Preparation buffer</span><strong>10 minutes</strong></div>
                <div className={styles.servicePreviewRow}><span>Recovery buffer</span><strong>10 minutes</strong></div>
                <div className={styles.servicePreviewRow}><span>Expected room occupancy</span><strong>95 minutes</strong></div>
                <div className={styles.servicePreviewRow}><span>Service value</span><strong>{currency.format(82)}</strong></div>
              </div>
            </div>

            <div className={styles.formSection}>
              <h3>Connected records</h3>
              <div className={styles.servicePreview}>
                <div className={styles.servicePreviewRow}><span><Wrench size={14} /> Service</span><strong>Shared catalogue</strong></div>
                <div className={styles.servicePreviewRow}><span><UsersRound size={14} /> Customer</span><strong>Customer history</strong></div>
                <div className={styles.servicePreviewRow}><span><PackageCheck size={14} /> Products</span><strong>On completion only</strong></div>
                <div className={styles.servicePreviewRow}><span><CreditCard size={14} /> Accounts</span><strong>Optional invoice</strong></div>
                <div className={styles.servicePreviewRow}><span><MessageSquareText size={14} /> Communications</span><strong>Reminder workflow</strong></div>
              </div>
              <div className={styles.conflictPanel}>
                <AlertTriangle size={18} />
                <div><strong>Availability not yet verified</strong><span>The final workflow must check staff, room, service buffers, working hours and leave before saving.</span></div>
              </div>
            </div>
          </div>
        </div>
        <div className="dialog-actions">
          <Button type="button" variant="quiet" onClick={() => setNewAppointmentOpen(false)}>Close preview</Button>
          <Button type="button" variant="secondary" disabled>Save draft</Button>
          <Button type="button" disabled>Create appointment</Button>
        </div>
      </Dialog>
    </>
  );
}
