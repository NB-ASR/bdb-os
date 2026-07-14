"use client";

import { useState, type FormEvent } from "react";
import { CalendarCheck2, CalendarDays, Clock3, Plus, UserRoundCheck } from "lucide-react";
import { useBdb } from "@/lib/store";
import { formatDate } from "@/lib/format";
import { Badge, Button, Card, Dialog, PageHeader, SectionHeading, StatCard } from "@/components/ui";
import type { BookingStatus } from "@/lib/types";

const bookingTone: Record<BookingStatus, "green" | "gold" | "neutral"> = { confirmed: "green", pending: "gold", completed: "neutral" };

export default function CalendarPage() {
  const { state, addBooking } = useBdb();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ customerId: state.customers[0]?.id ?? "", title: "", date: "2026-07-16", time: "10:00", duration: "60", staff: "Nicholas", status: "confirmed" as BookingStatus });
  const grouped = (() => {
    const map = new Map<string, typeof state.bookings>();
    state.bookings.forEach((booking) => map.set(booking.date, [...(map.get(booking.date) ?? []), booking]));
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  })();

  function submit(event: FormEvent) {
    event.preventDefault();
    addBooking({ ...form, duration: Number(form.duration) });
    setForm({ customerId: state.customers[0]?.id ?? "", title: "", date: "2026-07-16", time: "10:00", duration: "60", staff: "Nicholas", status: "confirmed" });
    setOpen(false);
  }

  return (
    <>
      <PageHeader eyebrow="Scheduling workspace" title="Calendar" description="Bookings and availability, connected directly to customer records and conversations." action={<Button onClick={() => setOpen(true)}><Plus size={17} /> New booking</Button>} />
      <div className="stat-grid">
        <StatCard label="Today" value={String(state.bookings.filter((item) => item.date === "2026-07-14").length)} detail="Appointments" icon={<CalendarDays size={19} />} />
        <StatCard label="This week" value={String(state.bookings.length)} detail="Scheduled bookings" icon={<CalendarCheck2 size={19} />} />
        <StatCard label="Confirmed" value={String(state.bookings.filter((item) => item.status === "confirmed").length)} detail="Ready to go" icon={<UserRoundCheck size={19} />} />
        <StatCard label="Booked time" value={`${state.bookings.reduce((sum, item) => sum + item.duration, 0) / 60}h`} detail="Across the week" icon={<Clock3 size={19} />} />
      </div>

      <div className="two-column">
        <Card>
          <div className="card-pad" style={{ paddingBottom: 8 }}><SectionHeading title="Upcoming schedule" description="Tuesday 14 – Friday 17 July" /></div>
          <div className="agenda">
            {grouped.map(([date, bookings]) => (
              <div className="agenda-day" key={date}>
                <div className="date-box"><strong>{formatDate(date, { weekday: "short" })}</strong><span>{formatDate(date, { day: "numeric", month: "short" })}</span></div>
                <div className="booking-stack">
                  {bookings.sort((a, b) => a.time.localeCompare(b.time)).map((booking) => {
                    const customer = state.customers.find((item) => item.id === booking.customerId);
                    return <div className="booking-item" key={booking.id}><span className="booking-time">{booking.time}</span><span className="booking-copy"><strong>{booking.title}</strong><small>{customer?.name} · {booking.staff} · {booking.duration} min</small></span><Badge tone={bookingTone[booking.status]}>{booking.status}</Badge></div>;
                  })}
                </div>
              </div>
            ))}
          </div>
        </Card>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <Card className="card-pad"><SectionHeading title="Availability" /><div className="focus-list"><div className="focus-item"><span className="focus-dot" /><div><strong>Wednesday afternoon</strong><p>Three hours open after 13:30.</p></div></div><div className="focus-item"><span className="focus-dot" /><div><strong>Thursday morning</strong><p>Available from 09:00–12:00.</p></div></div><div className="focus-item"><span className="focus-dot" /><div><strong>Friday afternoon</strong><p>No bookings after 10:30.</p></div></div></div></Card>
          <Card className="card-pad"><p className="eyebrow">Scheduling rule</p><h2>15-minute buffer enabled</h2><p className="muted small" style={{ margin: 0 }}>BDB prevents overlapping bookings for the same team member.</p></Card>
        </div>
      </div>

      <Dialog open={open} onClose={() => setOpen(false)} title="Create booking" description="The customer’s record and calendar update together.">
        <form onSubmit={submit}>
          <div className="form-grid">
            <div className="field field-full"><label htmlFor="booking-customer">Customer</label><select id="booking-customer" value={form.customerId} onChange={(event) => setForm({ ...form, customerId: event.target.value })}>{state.customers.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.company}</option>)}</select></div>
            <div className="field field-full"><label htmlFor="booking-title">Appointment</label><input id="booking-title" required value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="e.g. Project review" /></div>
            <div className="field"><label htmlFor="booking-date">Date</label><input id="booking-date" required type="date" value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} /></div>
            <div className="field"><label htmlFor="booking-time">Time</label><input id="booking-time" required type="time" value={form.time} onChange={(event) => setForm({ ...form, time: event.target.value })} /></div>
            <div className="field"><label htmlFor="booking-duration">Duration</label><select id="booking-duration" value={form.duration} onChange={(event) => setForm({ ...form, duration: event.target.value })}><option value="30">30 minutes</option><option value="45">45 minutes</option><option value="60">1 hour</option><option value="90">1.5 hours</option></select></div>
            <div className="field"><label htmlFor="booking-staff">Team member</label><select id="booking-staff" value={form.staff} onChange={(event) => setForm({ ...form, staff: event.target.value })}><option>Nicholas</option><option>Mariah</option></select></div>
          </div>
          <div className="dialog-actions"><Button type="button" variant="quiet" onClick={() => setOpen(false)}>Cancel</Button><Button type="submit">Create booking</Button></div>
        </form>
      </Dialog>
    </>
  );
}
