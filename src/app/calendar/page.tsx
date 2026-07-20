"use client";

import { useMemo, useState, type FormEvent } from "react";
import { AlertCircle, CalendarCheck2, CalendarDays, Clock3, Plus, UserRoundCheck } from "lucide-react";
import { useBdb } from "@/lib/store";
import { formatDate } from "@/lib/format";
import { Badge, Button, Card, Dialog, PageHeader, SectionHeading, StatCard } from "@/components/ui";
import type { BookingStatus } from "@/lib/types";

const bookingTone: Record<BookingStatus, "green" | "gold" | "neutral"> = { confirmed: "green", pending: "gold", completed: "neutral" };

function dateKey(date = new Date()) {
  return date.toLocaleDateString("en-CA");
}

function nextHour() {
  const date = new Date();
  date.setMinutes(0, 0, 0);
  date.setHours(date.getHours() + 1);
  return `${String(date.getHours()).padStart(2, "0")}:00`;
}

export default function CalendarPage() {
  const { state, addBooking } = useBdb();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const initialCustomer = state.customers[0]?.id ?? "";
  const [form, setForm] = useState({ customerId: initialCustomer, title: "", date: dateKey(), time: nextHour(), duration: "60", staff: "", status: "confirmed" as BookingStatus });

  const grouped = useMemo(() => {
    const map = new Map<string, typeof state.bookings>();
    state.bookings.forEach((booking) => map.set(booking.date, [...(map.get(booking.date) ?? []), booking]));
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [state.bookings]);
  const today = dateKey();
  const todayBookings = state.bookings.filter((item) => item.date === today);
  const upcoming = state.bookings.filter((item) => new Date(`${item.date}T${item.time}`).getTime() >= Date.now());
  const confirmed = state.bookings.filter((item) => item.status === "confirmed");
  const bookedMinutes = upcoming.reduce((sum, item) => sum + item.duration, 0);
  const firstDate = grouped[0]?.[0];
  const lastDate = grouped.at(-1)?.[0];
  const rangeLabel = firstDate ? `${formatDate(firstDate, { day: "numeric", month: "short" })}${lastDate && lastDate !== firstDate ? ` – ${formatDate(lastDate, { day: "numeric", month: "short" })}` : ""}` : "No bookings scheduled";

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!form.customerId || !form.title || !form.staff || saving) return;
    setSaving(true);
    const saved = await addBooking({ ...form, duration: Number(form.duration) });
    setSaving(false);
    if (!saved) return;
    setForm({ customerId: state.customers[0]?.id ?? "", title: "", date: dateKey(), time: nextHour(), duration: "60", staff: "", status: "confirmed" });
    setOpen(false);
  }

  const canCreate = state.customers.length > 0;

  return (
    <>
      <PageHeader eyebrow="Scheduling workspace" title="Calendar" description="Bookings connected directly to customer records. Availability rules remain human-controlled until the scheduling engine is configured." action={<Button disabled={!canCreate} onClick={() => setOpen(true)}><Plus size={17} /> New booking</Button>} />
      {!canCreate ? <div className="review-callout"><AlertCircle size={19} /><div><strong>Add a customer before creating a booking</strong><p>Every appointment must connect to a customer record.</p></div></div> : null}
      <div className="stat-grid">
        <StatCard label="Today" value={String(todayBookings.length)} detail="Appointments" icon={<CalendarDays size={19} />} />
        <StatCard label="Upcoming" value={String(upcoming.length)} detail="Future bookings" icon={<CalendarCheck2 size={19} />} />
        <StatCard label="Confirmed" value={String(confirmed.length)} detail="Across the schedule" icon={<UserRoundCheck size={19} />} />
        <StatCard label="Booked time" value={`${Math.round(bookedMinutes / 6) / 10}h`} detail="Upcoming appointments" icon={<Clock3 size={19} />} />
      </div>

      <div className="two-column">
        <Card>
          <div className="card-pad" style={{ paddingBottom: 8 }}><SectionHeading title="Upcoming schedule" description={rangeLabel} /></div>
          {grouped.length > 0 ? <div className="agenda">
            {grouped.map(([date, bookings]) => (
              <div className="agenda-day" key={date}>
                <div className="date-box"><strong>{formatDate(date, { weekday: "short" })}</strong><span>{formatDate(date, { day: "numeric", month: "short" })}</span></div>
                <div className="booking-stack">
                  {[...bookings].sort((a, b) => a.time.localeCompare(b.time)).map((booking) => {
                    const customer = state.customers.find((item) => item.id === booking.customerId);
                    return <div className="booking-item" key={booking.id}><span className="booking-time">{booking.time}</span><span className="booking-copy"><strong>{booking.title}</strong><small>{customer?.name ?? "Unknown customer"} · {booking.staff || "Unassigned"} · {booking.duration} min</small></span><Badge tone={bookingTone[booking.status]}>{booking.status}</Badge></div>;
                  })}
                </div>
              </div>
            ))}
          </div> : <div className="card-pad"><h2>No bookings scheduled</h2><p className="muted">Create the first booking after adding a customer.</p></div>}
        </Card>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <Card className="card-pad"><p className="eyebrow">Availability</p><h2>Working hours not configured</h2><p className="muted small" style={{ margin: 0 }}>BDB OS can show recorded bookings, but it will not invent open slots. Working hours, leave and room availability must be configured before automated availability is enabled.</p></Card>
          <Card className="card-pad"><p className="eyebrow">Conflict protection</p><h2>Manual review required</h2><p className="muted small" style={{ margin: 0 }}>The current booking form does not yet enforce staff or room conflicts. Review the schedule before confirming an appointment.</p></Card>
        </div>
      </div>

      <Dialog open={open} onClose={() => { if (!saving) setOpen(false); }} title="Create booking" description="The booking appears after the workspace confirms the save. Check availability before confirming.">
        <form onSubmit={submit}>
          <div className="form-grid">
            <div className="field field-full"><label htmlFor="booking-customer">Customer</label><select id="booking-customer" required value={form.customerId} onChange={(event) => setForm({ ...form, customerId: event.target.value })}>{state.customers.map((item) => <option key={item.id} value={item.id}>{item.name}{item.company ? ` · ${item.company}` : ""}</option>)}</select></div>
            <div className="field field-full"><label htmlFor="booking-title">Appointment</label><input id="booking-title" required value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="Appointment or meeting" /></div>
            <div className="field"><label htmlFor="booking-date">Date</label><input id="booking-date" required type="date" min={today} value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} /></div>
            <div className="field"><label htmlFor="booking-time">Time</label><input id="booking-time" required type="time" value={form.time} onChange={(event) => setForm({ ...form, time: event.target.value })} /></div>
            <div className="field"><label htmlFor="booking-duration">Duration</label><select id="booking-duration" value={form.duration} onChange={(event) => setForm({ ...form, duration: event.target.value })}><option value="30">30 minutes</option><option value="45">45 minutes</option><option value="60">1 hour</option><option value="90">1.5 hours</option></select></div>
            <div className="field"><label htmlFor="booking-staff">Team member</label><input id="booking-staff" required value={form.staff} onChange={(event) => setForm({ ...form, staff: event.target.value })} placeholder="Assigned person" /></div>
          </div>
          <div className="dialog-actions"><Button type="button" variant="quiet" disabled={saving} onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" disabled={saving}>{saving ? "Saving…" : "Create booking"}</Button></div>
        </form>
      </Dialog>
    </>
  );
}
