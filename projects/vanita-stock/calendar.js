(function () {
  const RELEASE = "v24";
  const STATUS_META = {
    tentative:{ label:"Tentative", tone:"tentative" },
    confirmed:{ label:"Confirmed", tone:"confirmed" },
    "checked-in":{ label:"Checked in", tone:"checked-in" },
    "in-progress":{ label:"In progress", tone:"in-progress" },
    completed:{ label:"Completed", tone:"completed" },
    cancelled:{ label:"Cancelled", tone:"cancelled" },
    "no-show":{ label:"No-show", tone:"no-show" }
  };
  const BOOKING_SOURCES = ["Telephone","Walk-in","WhatsApp","Facebook","Instagram","Website","Returning booking","Other"];
  const WEEKDAY_LABELS = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
  const DAY_START_MINUTES = 8 * 60;
  const DAY_END_MINUTES = 20 * 60;
  const SLOT_MINUTES = 30;
  const SLOT_HEIGHT = 44;

  let originalNormalizeState = null;
  let originalRenderAll = null;
  let originalSwitchView = null;
  let selectedDate = new Date();
  let viewMode = window.innerWidth <= 720 ? "agenda" : "day";
  let filters = { query:"", staff:"all", status:"all" };
  let pendingRestoreAppointments = null;
  let pendingAppointmentSale = null;
  let calendarGuide = null;

  const pad = value => String(value).padStart(2, "0");
  const dateKey = value => {
    const date = value instanceof Date ? value : new Date(`${String(value).slice(0, 10)}T12:00:00`);
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  };
  const parseDate = value => value instanceof Date ? new Date(value) : new Date(`${String(value).slice(0, 10)}T12:00:00`);
  const startOfDay = value => {
    const date = value instanceof Date ? new Date(value) : parseDate(value);
    date.setHours(0, 0, 0, 0);
    return date;
  };
  const addDays = (value, days) => {
    const date = startOfDay(value);
    date.setDate(date.getDate() + days);
    return date;
  };
  const startOfWeek = value => {
    const date = startOfDay(value);
    const offset = (date.getDay() + 6) % 7;
    return addDays(date, -offset);
  };
  const startOfMonth = value => new Date(value.getFullYear(), value.getMonth(), 1);
  const minutesFromTime = value => {
    const [hours, minutes] = String(value || "00:00").split(":").map(Number);
    return Math.max(0, (hours || 0) * 60 + (minutes || 0));
  };
  const timeFromMinutes = value => `${pad(Math.floor(value / 60) % 24)}:${pad(value % 60)}`;
  const addMinutes = (time, minutes) => timeFromMinutes(minutesFromTime(time) + Number(minutes || 0));
  const intervalsOverlap = (startA, endA, startB, endB) => startA < endB && startB < endA;
  const clone = value => typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value));
  const makeCalendarId = prefix => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const money = value => currency(Number(value) || 0);
  const activeTeam = () => (state.teamMembers || []).filter(member => member.active !== false).sort((a, b) => a.name.localeCompare(b.name));
  const activeClients = () => (state.clients || []).filter(client => client.active !== false).sort((a, b) => a.name.localeCompare(b.name));
  const activeCalendarServices = () => (state.services || []).filter(service => service.active !== false).sort((a, b) => a.name.localeCompare(b.name));
  const serviceById = id => (state.services || []).find(service => service.id === id);
  const memberById = id => (state.teamMembers || []).find(member => member.id === id);
  const clientById = id => (state.clients || []).find(client => client.id === id);

  function defaultWeek() {
    return {
      0:{ enabled:false, start:"09:00", end:"17:00" },
      1:{ enabled:true, start:"09:00", end:"18:00" },
      2:{ enabled:true, start:"09:00", end:"18:00" },
      3:{ enabled:true, start:"09:00", end:"18:00" },
      4:{ enabled:true, start:"09:00", end:"18:00" },
      5:{ enabled:true, start:"09:00", end:"18:00" },
      6:{ enabled:true, start:"09:00", end:"16:00" }
    };
  }

  function normaliseSegment(segment = {}) {
    const service = serviceById(segment.serviceId);
    const member = memberById(segment.staffId);
    return {
      id:String(segment.id || makeCalendarId("seg")),
      serviceId:String(segment.serviceId || ""),
      serviceName:String(segment.serviceName || service?.name || "Service"),
      staffId:String(segment.staffId || ""),
      staffName:String(segment.staffName || member?.name || ""),
      startTime:String(segment.startTime || "09:00").slice(0, 5),
      duration:Math.max(5, Number(segment.duration ?? service?.duration) || 60),
      price:Math.max(0, Number(segment.price ?? service?.price) || 0)
    };
  }

  function normaliseAppointment(appointment = {}) {
    const segments = Array.isArray(appointment.services)
      ? appointment.services.map(normaliseSegment)
      : appointment.serviceId
        ? [normaliseSegment(appointment)]
        : [];
    const sorted = segments.sort((a, b) => minutesFromTime(a.startTime) - minutesFromTime(b.startTime));
    const first = sorted[0];
    const endMinutes = sorted.reduce((maximum, segment) => Math.max(maximum, minutesFromTime(segment.startTime) + segment.duration), first ? minutesFromTime(first.startTime) : 0);
    const subtotal = sorted.reduce((sum, segment) => sum + segment.price, 0);
    const discount = Math.min(subtotal, Math.max(0, Number(appointment.discount) || 0));
    return {
      id:String(appointment.id || makeCalendarId("APT")),
      clientId:String(appointment.clientId || ""),
      clientName:String(appointment.clientName || clientById(appointment.clientId)?.name || "Walk-in"),
      date:String(appointment.date || dateKey(new Date())).slice(0, 10),
      startTime:String(appointment.startTime || first?.startTime || "09:00").slice(0, 5),
      endTime:String(appointment.endTime || (first ? timeFromMinutes(endMinutes) : "10:00")).slice(0, 5),
      status:STATUS_META[appointment.status] ? appointment.status : "confirmed",
      bookingSource:BOOKING_SOURCES.includes(appointment.bookingSource) ? appointment.bookingSource : "Telephone",
      services:sorted,
      subtotal,
      discount,
      total:Math.max(0, Number(appointment.total ?? (subtotal - discount)) || 0),
      deposit:Math.max(0, Number(appointment.deposit) || 0),
      depositStatus:String(appointment.depositStatus || (Number(appointment.deposit) > 0 ? "paid" : "not-paid")),
      room:String(appointment.room || "").trim(),
      notes:String(appointment.notes || "").trim(),
      clientNotes:String(appointment.clientNotes || "").trim(),
      reminderStatus:String(appointment.reminderStatus || "not-sent"),
      saleId:appointment.saleId || null,
      createdAt:appointment.createdAt || new Date().toISOString(),
      updatedAt:appointment.updatedAt || appointment.createdAt || new Date().toISOString(),
      conflictOverride:appointment.conflictOverride === true
    };
  }

  function ensureCalendarState(data) {
    if (!data || typeof data !== "object") return data;
    if (!Array.isArray(data.appointments)) data.appointments = [];
    data.appointments = data.appointments.map(normaliseAppointment);
    if (!data.calendarSettings || typeof data.calendarSettings !== "object") data.calendarSettings = {};
    if (!data.calendarSettings.staffSchedules || typeof data.calendarSettings.staffSchedules !== "object") data.calendarSettings.staffSchedules = {};
    if (!Array.isArray(data.calendarSettings.blocks)) data.calendarSettings.blocks = [];
    data.calendarSettings.blocks = data.calendarSettings.blocks.map(block => ({
      id:String(block.id || makeCalendarId("block")),
      staffId:String(block.staffId || ""),
      date:String(block.date || dateKey(new Date())).slice(0, 10),
      startTime:String(block.startTime || "09:00").slice(0, 5),
      endTime:String(block.endTime || "10:00").slice(0, 5),
      reason:String(block.reason || "Unavailable").trim()
    }));
    (data.teamMembers || []).filter(member => member.active !== false).forEach(member => {
      if (!data.calendarSettings.staffSchedules[member.id]) {
        data.calendarSettings.staffSchedules[member.id] = { week:defaultWeek() };
      } else if (!data.calendarSettings.staffSchedules[member.id].week) {
        data.calendarSettings.staffSchedules[member.id].week = defaultWeek();
      }
    });
    data.calendarSettings.slotMinutes = Number(data.calendarSettings.slotMinutes) || 15;
    return data;
  }

  function staffSchedule(staffId, date) {
    ensureCalendarState(state);
    const schedule = state.calendarSettings.staffSchedules[staffId]?.week || defaultWeek();
    return schedule[new Date(`${dateKey(date)}T12:00:00`).getDay()] || { enabled:false, start:"09:00", end:"17:00" };
  }

  function qualifiedStaff(service) {
    const ids = Array.isArray(service?.staffIds) ? service.staffIds : [];
    const selected = ids.length
      ? activeTeam().filter(member => ids.includes(member.id))
      : activeTeam();
    return selected;
  }

  function appointmentSegments(appointment, staffId = null) {
    return (appointment.services || []).filter(segment => !staffId || segment.staffId === staffId);
  }

  function appointmentMatches(appointment) {
    if (filters.status !== "all" && appointment.status !== filters.status) return false;
    if (filters.staff !== "all" && !appointment.services.some(segment => segment.staffId === filters.staff)) return false;
    const query = filters.query.trim().toLowerCase();
    if (!query) return true;
    const values = [
      appointment.clientName,
      appointment.bookingSource,
      appointment.notes,
      appointment.clientNotes,
      ...appointment.services.flatMap(segment => [segment.serviceName, segment.staffName])
    ];
    return values.some(value => String(value || "").toLowerCase().includes(query));
  }

  function sortedAppointments() {
    return (state.appointments || [])
      .filter(appointmentMatches)
      .slice()
      .sort((a, b) => `${a.date}T${a.startTime}`.localeCompare(`${b.date}T${b.startTime}`));
  }

  function statusMarkup(status) {
    const meta = STATUS_META[status] || STATUS_META.confirmed;
    return `<span class="calendar-status ${meta.tone}">${escapeHtml(meta.label)}</span>`;
  }

  function formatDateHeading() {
    if (viewMode === "day") return selectedDate.toLocaleDateString("en-GB", { weekday:"long", day:"numeric", month:"long", year:"numeric" });
    if (viewMode === "week") {
      const start = startOfWeek(selectedDate);
      const end = addDays(start, 6);
      return `${start.toLocaleDateString("en-GB", { day:"numeric", month:"short" })} – ${end.toLocaleDateString("en-GB", { day:"numeric", month:"short", year:"numeric" })}`;
    }
    return selectedDate.toLocaleDateString("en-GB", { month:"long", year:"numeric" });
  }

  function injectInterface() {
    if (!document.querySelector('[data-view="calendar"]')) {
      const anchor = document.querySelector('.main-nav [data-view="clients"]') || document.querySelector('.main-nav [data-view="services"]');
      anchor?.insertAdjacentHTML("afterend", `<button class="nav-item" data-view="calendar"><span class="nav-icon">▦</span><span>Calendar</span></button>`);
    }
    if (!document.querySelector('.mobile-nav [data-view="calendar"]')) {
      const mobileAnchor = document.querySelector('.mobile-nav [data-view="invoices"]');
      mobileAnchor?.insertAdjacentHTML("beforebegin", `<button data-view="calendar"><span>▦</span>Calendar</button>`);
    }
    if (!document.querySelector("#calendarView")) {
      const anchorView = document.querySelector("#invoicesView");
      anchorView?.insertAdjacentHTML("beforebegin", `
        <section class="view" id="calendarView">
          <div class="page-heading calendar-page-heading">
            <div>
              <p class="eyebrow">APPOINTMENTS &amp; AVAILABILITY</p>
              <h1>Calendar</h1>
              <p>Schedule clients, assign qualified staff and convert completed appointments into sales.</p>
            </div>
            <div class="heading-actions">
              <button class="secondary-button" data-calendar-action="working-hours">Working hours</button>
              <button class="secondary-button" data-calendar-action="block-time">Block time</button>
              <button class="primary-button" data-calendar-action="new">＋ New appointment</button>
            </div>
          </div>
          <div class="calendar-summary" id="calendarSummary"></div>
          <div class="calendar-toolbar panel">
            <div class="calendar-date-controls">
              <button class="icon-button" data-calendar-action="previous" aria-label="Previous period">←</button>
              <button class="secondary-button compact" data-calendar-action="today">Today</button>
              <button class="icon-button" data-calendar-action="next" aria-label="Next period">→</button>
              <strong id="calendarDateLabel"></strong>
            </div>
            <div class="calendar-view-controls" aria-label="Calendar view">
              ${["day","week","month","agenda"].map(mode => `<button class="chip ${viewMode === mode ? "active" : ""}" data-calendar-mode="${mode}">${mode[0].toUpperCase() + mode.slice(1)}</button>`).join("")}
            </div>
          </div>
          <div class="calendar-filters panel">
            <label class="table-search"><span>⌕</span><input id="calendarSearch" placeholder="Search client, service, staff or notes" /></label>
            <select class="toolbar-select" id="calendarStaffFilter" aria-label="Filter by staff"></select>
            <select class="toolbar-select" id="calendarStatusFilter" aria-label="Filter by status"></select>
          </div>
          <div id="calendarContent"></div>
        </section>
      `);
    }
    injectStyles();
  }

  function injectStyles() {
    if (document.querySelector("#calendarStyles")) return;
    const style = document.createElement("style");
    style.id = "calendarStyles";
    style.textContent = `
      .calendar-page-heading { align-items:center; }
      .calendar-summary { display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-bottom:15px; }
      .calendar-stat { display:flex;align-items:center;gap:11px;padding:15px;border:1px solid var(--line);border-radius:14px;background:#fff; }
      .calendar-stat > span { display:grid;width:36px;height:36px;place-items:center;border-radius:10px;background:#edf4f1;color:#346d5c;font-size:17px; }
      .calendar-stat strong { display:block;color:#213c34;font:800 17px "Manrope",sans-serif; }
      .calendar-stat small { color:#788680;font-size:10px; }
      .calendar-toolbar,.calendar-filters { display:flex;align-items:center;justify-content:space-between;gap:13px;padding:12px 14px;margin-bottom:12px; }
      .calendar-date-controls,.calendar-view-controls { display:flex;align-items:center;gap:8px; }
      .calendar-date-controls strong { margin-left:5px;color:#2a443c;font:700 14px "Manrope",sans-serif; }
      .calendar-filters .table-search { flex:1;max-width:520px; }
      .calendar-shell { border:1px solid var(--line);border-radius:16px;background:#fff;overflow:hidden; }
      .calendar-day-grid { display:grid;grid-template-columns:70px repeat(var(--calendar-staff-count),minmax(180px,1fr));min-width:max-content;overflow:auto; }
      .calendar-time-axis,.calendar-staff-column { border-right:1px solid #e5ece8; }
      .calendar-day-header { position:sticky;top:0;z-index:5;height:58px;display:flex;align-items:center;justify-content:center;padding:8px;border-bottom:1px solid #dfe7e3;background:#f8fbfa; }
      .calendar-day-header div { min-width:0;text-align:center; }
      .calendar-day-header strong { display:block;color:#26453b;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis; }
      .calendar-day-header small { color:#7a8b85;font-size:9px; }
      .calendar-time-track,.calendar-staff-track { position:relative;height:${((DAY_END_MINUTES - DAY_START_MINUTES) / SLOT_MINUTES) * SLOT_HEIGHT}px; }
      .calendar-time-label { position:absolute;left:0;right:0;transform:translateY(-7px);padding-right:9px;text-align:right;color:#89958f;font-size:9px; }
      .calendar-slot { position:absolute;left:0;right:0;height:${SLOT_HEIGHT}px;border:0;border-top:1px solid #edf1ef;background:transparent;cursor:pointer; }
      .calendar-slot:hover { background:#f3f8f6; }
      .calendar-appointment { position:absolute;left:6px;right:6px;z-index:3;overflow:hidden;padding:7px 8px;border:1px solid #91bcad;border-left:4px solid #397963;border-radius:9px;background:#eaf5f0;color:#214a3d;text-align:left;cursor:pointer;box-shadow:0 2px 7px rgba(38,75,64,.09); }
      .calendar-appointment:hover { transform:translateY(-1px);box-shadow:0 5px 14px rgba(38,75,64,.14); }
      .calendar-appointment strong { display:block;font-size:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis; }
      .calendar-appointment small { display:block;margin-top:2px;color:#55766b;font-size:8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis; }
      .calendar-appointment.cancelled,.calendar-appointment.no-show { border-color:#d6a7a2;border-left-color:#aa544b;background:#fff0ee;color:#83413b;opacity:.78; }
      .calendar-appointment.completed { border-color:#a8b7b1;border-left-color:#71827c;background:#f0f3f2;color:#53635e; }
      .calendar-block { position:absolute;left:6px;right:6px;z-index:2;padding:6px;border:1px dashed #bf9d6c;border-radius:8px;background:repeating-linear-gradient(-45deg,#fff8e9,#fff8e9 7px,#f9efd8 7px,#f9efd8 14px);color:#7e6134;font-size:9px;cursor:pointer;overflow:hidden; }
      .calendar-week-grid { display:grid;grid-template-columns:repeat(7,minmax(150px,1fr));min-width:980px; }
      .calendar-week-day { min-height:430px;border-right:1px solid #e5ece8;background:#fff; }
      .calendar-week-day:last-child { border-right:0; }
      .calendar-week-heading { padding:12px;border-bottom:1px solid #e5ece8;background:#f8fbfa;text-align:center;cursor:pointer; }
      .calendar-week-heading strong { display:block;color:#29483e;font-size:12px; }
      .calendar-week-heading small { color:#82918c;font-size:9px; }
      .calendar-week-list { display:grid;gap:7px;padding:9px; }
      .calendar-list-card { display:grid;gap:4px;padding:9px;border:1px solid #dce7e2;border-left:4px solid #4a8974;border-radius:9px;background:#f8fbfa;cursor:pointer; }
      .calendar-list-card strong { color:#29473e;font-size:11px; }
      .calendar-list-card small { color:#71817b;font-size:9px; }
      .calendar-list-card.cancelled,.calendar-list-card.no-show { border-left-color:#aa544b;background:#fff5f3; }
      .calendar-month-grid { display:grid;grid-template-columns:repeat(7,1fr); }
      .calendar-month-weekday { padding:9px;text-align:center;background:#f5f8f7;color:#687a74;font-size:9px;font-weight:800;text-transform:uppercase; }
      .calendar-month-day { min-height:118px;padding:8px;border-top:1px solid #e7ecea;border-right:1px solid #e7ecea;background:#fff;text-align:left;cursor:pointer; }
      .calendar-month-day:nth-child(7n) { border-right:0; }
      .calendar-month-day.outside { background:#fafbfa;color:#a0aaa6; }
      .calendar-month-day.today { box-shadow:inset 0 0 0 2px #67a491; }
      .calendar-month-day > strong { display:block;margin-bottom:7px;font-size:11px; }
      .calendar-month-day span { display:block;margin-bottom:4px;color:#385e52;font-size:9px;font-weight:700; }
      .calendar-month-day small { color:#7d8c87;font-size:8px; }
      .calendar-agenda { display:grid;gap:10px; }
      .calendar-agenda-day { border:1px solid var(--line);border-radius:14px;background:#fff;overflow:hidden; }
      .calendar-agenda-day > h3 { margin:0;padding:11px 14px;border-bottom:1px solid #e6ece9;background:#f8fbfa;color:#29463d;font-size:12px; }
      .calendar-agenda-row { display:grid;grid-template-columns:80px 1fr auto;gap:12px;align-items:center;padding:12px 14px;border-bottom:1px solid #edf1ef;cursor:pointer; }
      .calendar-agenda-row:last-child { border-bottom:0; }
      .calendar-agenda-row time { color:#2f6353;font-weight:800;font-size:11px; }
      .calendar-agenda-row strong { display:block;color:#243e36;font-size:11px; }
      .calendar-agenda-row small { color:#74847e;font-size:9px; }
      .calendar-status { display:inline-flex;padding:4px 7px;border-radius:999px;background:#edf2f0;color:#53665f;font-size:8px;font-weight:800;text-transform:uppercase;letter-spacing:.04em;white-space:nowrap; }
      .calendar-status.confirmed { background:#e5f3ed;color:#2e6d58; }
      .calendar-status.tentative { background:#fff5dc;color:#896b23; }
      .calendar-status.checked-in,.calendar-status.in-progress { background:#e9effa;color:#47628f; }
      .calendar-status.completed { background:#edf0ef;color:#5d6b66; }
      .calendar-status.cancelled,.calendar-status.no-show { background:#fff0ee;color:#9a4c44; }
      .calendar-empty { padding:45px 20px;text-align:center;border:1px dashed #cfdbd6;border-radius:14px;background:#fbfcfb;color:#74837e; }
      .calendar-empty span { display:block;margin-bottom:8px;font-size:28px; }
      .appointment-form { display:grid;gap:16px; }
      .appointment-grid { display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px; }
      .appointment-grid label,.appointment-extra-grid label,.calendar-schedule-row label { display:grid;gap:6px;color:#41534d;font-size:10px;font-weight:700; }
      .appointment-grid input,.appointment-grid select,.appointment-extra-grid input,.appointment-extra-grid select,.appointment-extra-grid textarea,.calendar-schedule-row input,.calendar-schedule-row select { width:100%;padding:10px 11px;border:1px solid #d7e0dc;border-radius:9px;background:#fff;color:#294039;font:inherit; }
      .appointment-client-row { display:grid;grid-template-columns:1fr auto;gap:9px;align-items:end; }
      .quick-client-panel { display:grid;grid-template-columns:2fr 1fr 1fr auto;gap:9px;padding:12px;border:1px solid #dbe5e1;border-radius:11px;background:#f8fbfa; }
      .quick-client-panel[hidden] { display:none; }
      .appointment-service-section { border:1px solid #dce5e1;border-radius:12px;overflow:hidden; }
      .appointment-service-heading { display:flex;align-items:center;justify-content:space-between;padding:11px 13px;border-bottom:1px solid #e3e9e6;background:#f7faf9; }
      .appointment-service-heading strong { color:#2d4a41;font-size:11px; }
      .appointment-service-list { display:grid;gap:9px;padding:11px; }
      .appointment-service-row { display:grid;grid-template-columns:minmax(170px,2fr) minmax(140px,1.4fr) 105px 85px 95px 34px;gap:8px;align-items:end;padding:10px;border:1px solid #e3e9e6;border-radius:10px;background:#fff; }
      .appointment-service-row label { display:grid;gap:5px;color:#6f7f7a;font-size:8px;font-weight:800;text-transform:uppercase; }
      .appointment-service-row select,.appointment-service-row input { width:100%;padding:8px;border:1px solid #d8e1dd;border-radius:8px;background:#fff;font:inherit;color:#2a4039; }
      .appointment-service-row .remove-appointment-service { height:34px;border:0;border-radius:8px;background:#fff0ee;color:#a14942;cursor:pointer; }
      .appointment-extra-grid { display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px; }
      .appointment-extra-grid .wide { grid-column:1/-1; }
      .appointment-total { display:flex;justify-content:flex-end;gap:25px;padding:12px;border-radius:11px;background:#f2f7f5;color:#49645b; }
      .appointment-total span { text-align:right;font-size:9px; }
      .appointment-total strong { display:block;color:#24473b;font-size:15px; }
      .appointment-detail-grid { display:grid;grid-template-columns:repeat(3,1fr);gap:9px; }
      .appointment-detail-grid div { padding:11px;border:1px solid #e2e8e5;border-radius:10px;background:#fafbfa; }
      .appointment-detail-grid small { display:block;color:#84918d;font-size:8px;text-transform:uppercase;font-weight:800; }
      .appointment-detail-grid strong { display:block;margin-top:3px;color:#2b443c;font-size:11px; }
      .appointment-detail-services { display:grid;gap:7px; }
      .appointment-detail-service { display:grid;grid-template-columns:75px 1fr auto;gap:10px;padding:10px;border:1px solid #e1e8e5;border-radius:9px; }
      .appointment-detail-service time { color:#39735f;font-weight:800;font-size:10px; }
      .appointment-detail-actions { display:flex;flex-wrap:wrap;gap:8px; }
      .appointment-detail-actions button { flex:1 1 130px; }
      .calendar-schedule-list { display:grid;gap:8px; }
      .calendar-schedule-row { display:grid;grid-template-columns:28px 1fr 115px 115px;gap:9px;align-items:center;padding:9px;border:1px solid #e0e7e4;border-radius:9px; }
      .calendar-schedule-row > span { color:#3d554d;font-size:10px;font-weight:700; }
      .calendar-block-list { display:grid;gap:7px;margin-top:13px; }
      .calendar-block-item { display:grid;grid-template-columns:1fr auto;gap:9px;padding:9px;border:1px solid #eadfc9;border-radius:9px;background:#fffaf0; }
      .calendar-block-item strong { display:block;color:#6b5635;font-size:10px; }
      .calendar-block-item small { color:#8a7759;font-size:8px; }
      .calendar-conflict { margin-top:10px;padding:10px;border:1px solid #e0aaa4;border-radius:10px;background:#fff4f2;color:#88473f;font-size:10px;white-space:pre-line; }
      .calendar-sale-deposit { margin:12px 0;padding:11px;border:1px solid #aacdbf;border-radius:10px;background:#f1f8f5;color:#356456;font-size:11px; }
      .calendar-guide { position:fixed;inset:0;z-index:2147483200;pointer-events:none; }
      .calendar-guide::before { content:"";position:absolute;inset:0;background:rgba(8,27,22,.72);pointer-events:auto; }
      .calendar-guide-target { position:fixed;z-index:2;border:3px solid #84dbc0;border-radius:13px;box-shadow:0 0 0 5px rgba(132,219,192,.2); }
      .calendar-guide-bubble { position:fixed;z-index:3;width:min(360px,calc(100vw - 28px));padding:19px;border-radius:16px;background:#fff;box-shadow:0 20px 60px rgba(0,0,0,.28);pointer-events:auto; }
      .calendar-guide-bubble h2 { margin:0 35px 7px 0;color:#204339;font:800 18px "Manrope",sans-serif; }
      .calendar-guide-bubble p { margin:0;color:#60746d;font-size:12px;line-height:1.5; }
      .calendar-guide-close { position:absolute;top:10px;right:10px;width:32px;height:32px;border:0;border-radius:9px;background:#edf4f1;color:#315f52;font-size:19px;cursor:pointer; }
      .calendar-guide-footer { display:grid;grid-template-columns:1fr auto 1fr;align-items:center;margin-top:15px;padding-top:11px;border-top:1px solid #e4ebe8; }
      .calendar-guide-footer button { width:38px;height:36px;border:1px solid #c7d7d1;border-radius:9px;background:#f8fbfa;color:#2f6957;font-size:18px;cursor:pointer; }
      .calendar-guide-footer button:last-child { justify-self:end; }
      .calendar-guide-footer button:disabled { opacity:.3; }
      .calendar-guide-footer span { color:#687c75;font-size:10px;font-weight:800; }
      @media (max-width:1050px) {
        .calendar-summary { grid-template-columns:repeat(2,1fr); }
        .calendar-toolbar,.calendar-filters { flex-wrap:wrap; }
        .appointment-service-row { grid-template-columns:1fr 1fr 90px 80px 90px 34px; }
      }
      @media (max-width:780px) {
        .mobile-nav { grid-template-columns:repeat(8,minmax(58px,1fr)) !important;overflow-x:auto; }
        .calendar-page-heading { align-items:flex-start; }
        .calendar-page-heading .heading-actions { width:100%;display:grid;grid-template-columns:1fr 1fr; }
        .calendar-page-heading .heading-actions .primary-button { grid-column:1/-1; }
        .calendar-toolbar,.calendar-filters { align-items:stretch; }
        .calendar-date-controls { flex-wrap:wrap; }
        .calendar-date-controls strong { width:100%;margin:4px 0 0; }
        .calendar-view-controls { width:100%;overflow-x:auto; }
        .calendar-filters .table-search { max-width:none;width:100%; }
        .calendar-filters select { flex:1; }
        .calendar-week-grid { min-width:850px; }
        .calendar-month-day { min-height:85px;padding:6px; }
        .calendar-month-day span { display:none; }
        .appointment-grid,.appointment-extra-grid { grid-template-columns:1fr 1fr; }
        .appointment-grid .wide,.appointment-extra-grid .wide { grid-column:1/-1; }
        .appointment-service-row { grid-template-columns:1fr 1fr; }
        .appointment-service-row .remove-appointment-service { grid-column:2;justify-self:end;width:38px; }
        .quick-client-panel { grid-template-columns:1fr; }
        .appointment-detail-grid { grid-template-columns:1fr 1fr; }
      }
      @media (max-width:520px) {
        .calendar-summary { grid-template-columns:1fr 1fr; }
        .calendar-stat { padding:11px; }
        .calendar-month-grid { font-size:9px; }
        .calendar-month-day { min-height:70px; }
        .calendar-agenda-row { grid-template-columns:62px 1fr; }
        .calendar-agenda-row .calendar-status { grid-column:2;justify-self:start; }
        .appointment-grid,.appointment-extra-grid,.appointment-detail-grid { grid-template-columns:1fr; }
        .calendar-schedule-row { grid-template-columns:28px 1fr 1fr; }
        .calendar-schedule-row > span { grid-column:2/-1; }
      }
    `;
    document.head.append(style);
  }

  function updateFilterOptions() {
    const staff = document.querySelector("#calendarStaffFilter");
    const status = document.querySelector("#calendarStatusFilter");
    if (staff) {
      const value = filters.staff;
      staff.innerHTML = `<option value="all">All staff</option>${activeTeam().map(member => `<option value="${escapeHtml(member.id)}">${escapeHtml(member.name)}</option>`).join("")}`;
      staff.value = activeTeam().some(member => member.id === value) ? value : "all";
      filters.staff = staff.value;
    }
    if (status) {
      status.innerHTML = `<option value="all">All statuses</option>${Object.entries(STATUS_META).map(([value, meta]) => `<option value="${value}">${meta.label}</option>`).join("")}`;
      status.value = STATUS_META[filters.status] ? filters.status : "all";
      filters.status = status.value;
    }
  }

  function periodAppointments() {
    const appointments = sortedAppointments();
    if (viewMode === "day") return appointments.filter(item => item.date === dateKey(selectedDate));
    if (viewMode === "week") {
      const start = dateKey(startOfWeek(selectedDate));
      const end = dateKey(addDays(startOfWeek(selectedDate), 6));
      return appointments.filter(item => item.date >= start && item.date <= end);
    }
    const month = `${selectedDate.getFullYear()}-${pad(selectedDate.getMonth() + 1)}`;
    return appointments.filter(item => item.date.startsWith(month));
  }

  function renderSummary() {
    const target = document.querySelector("#calendarSummary");
    if (!target) return;
    const today = dateKey(new Date());
    const todayAppointments = (state.appointments || []).filter(item => item.date === today && !["cancelled","no-show"].includes(item.status));
    const period = periodAppointments().filter(item => !["cancelled","no-show"].includes(item.status));
    const revenue = period.reduce((sum, item) => sum + item.total, 0);
    const unassigned = period.filter(item => item.services.some(segment => !segment.staffId)).length;
    target.innerHTML = [
      ["▦", todayAppointments.length, "Appointments today"],
      ["✓", period.filter(item => item.status === "confirmed").length, "Confirmed in view"],
      ["€", money(revenue), "Expected revenue"],
      ["◎", unassigned, "Unassigned bookings"]
    ].map(([icon, value, label]) => `<article class="calendar-stat"><span>${icon}</span><div><strong>${escapeHtml(value)}</strong><small>${label}</small></div></article>`).join("");
  }

  function renderCalendar() {
    ensureCalendarState(state);
    updateFilterOptions();
    const label = document.querySelector("#calendarDateLabel");
    if (label) label.textContent = formatDateHeading();
    document.querySelectorAll("[data-calendar-mode]").forEach(button => button.classList.toggle("active", button.dataset.calendarMode === viewMode));
    renderSummary();
    if (viewMode === "day") renderDayView();
    if (viewMode === "week") renderWeekView();
    if (viewMode === "month") renderMonthView();
    if (viewMode === "agenda") renderAgendaView();
  }

  function visibleStaffForDate(date) {
    const staff = activeTeam().filter(member => filters.staff === "all" || member.id === filters.staff);
    return staff.length ? staff : [{ id:"", name:"Unassigned", title:"No staff selected" }];
  }

  function segmentPosition(segment) {
    const start = minutesFromTime(segment.startTime);
    const top = ((start - DAY_START_MINUTES) / SLOT_MINUTES) * SLOT_HEIGHT;
    const height = Math.max(28, (segment.duration / SLOT_MINUTES) * SLOT_HEIGHT - 3);
    return { top, height };
  }

  function renderDayView() {
    const target = document.querySelector("#calendarContent");
    const key = dateKey(selectedDate);
    const staff = visibleStaffForDate(selectedDate);
    const appointments = sortedAppointments().filter(item => item.date === key);
    const blocks = (state.calendarSettings.blocks || []).filter(block => block.date === key);
    const slotCount = (DAY_END_MINUTES - DAY_START_MINUTES) / SLOT_MINUTES;
    target.innerHTML = `
      <div class="calendar-shell">
        <div class="calendar-day-grid" style="--calendar-staff-count:${staff.length}">
          <div class="calendar-time-axis">
            <div class="calendar-day-header"><small>Time</small></div>
            <div class="calendar-time-track">
              ${Array.from({ length:slotCount + 1 }, (_, index) => {
                const minute = DAY_START_MINUTES + index * SLOT_MINUTES;
                return index % 2 === 0 ? `<span class="calendar-time-label" style="top:${index * SLOT_HEIGHT}px">${timeFromMinutes(minute)}</span>` : "";
              }).join("")}
            </div>
          </div>
          ${staff.map(member => {
            const memberAppointments = appointments.flatMap(appointment =>
              appointmentSegments(appointment, member.id || null).map(segment => ({ appointment, segment }))
            ).filter(entry => member.id ? entry.segment.staffId === member.id : !entry.segment.staffId);
            const memberBlocks = blocks.filter(block => block.staffId === member.id);
            const schedule = member.id ? staffSchedule(member.id, key) : null;
            return `<div class="calendar-staff-column">
              <div class="calendar-day-header"><div><strong>${escapeHtml(member.name)}</strong><small>${schedule?.enabled ? `${schedule.start}–${schedule.end}` : member.title || "Unassigned"}</small></div></div>
              <div class="calendar-staff-track">
                ${Array.from({ length:slotCount }, (_, index) => `<button class="calendar-slot" style="top:${index * SLOT_HEIGHT}px" data-calendar-new-date="${key}" data-calendar-new-time="${timeFromMinutes(DAY_START_MINUTES + index * SLOT_MINUTES)}" data-calendar-new-staff="${escapeHtml(member.id)}" aria-label="Create appointment at ${timeFromMinutes(DAY_START_MINUTES + index * SLOT_MINUTES)}"></button>`).join("")}
                ${memberBlocks.map(block => {
                  const top = ((minutesFromTime(block.startTime) - DAY_START_MINUTES) / SLOT_MINUTES) * SLOT_HEIGHT;
                  const height = Math.max(28, ((minutesFromTime(block.endTime) - minutesFromTime(block.startTime)) / SLOT_MINUTES) * SLOT_HEIGHT - 3);
                  return `<button class="calendar-block" style="top:${top}px;height:${height}px" data-calendar-block-id="${escapeHtml(block.id)}"><strong>${escapeHtml(block.reason)}</strong><br>${escapeHtml(block.startTime)}–${escapeHtml(block.endTime)}</button>`;
                }).join("")}
                ${memberAppointments.map(({ appointment, segment }) => {
                  const position = segmentPosition(segment);
                  return `<button class="calendar-appointment ${escapeHtml(appointment.status)}" style="top:${position.top}px;height:${position.height}px" data-appointment-id="${escapeHtml(appointment.id)}"><strong>${escapeHtml(appointment.clientName)}</strong><small>${escapeHtml(segment.startTime)} · ${escapeHtml(segment.serviceName)}</small></button>`;
                }).join("")}
              </div>
            </div>`;
          }).join("")}
        </div>
      </div>
    `;
  }

  function renderWeekView() {
    const target = document.querySelector("#calendarContent");
    const start = startOfWeek(selectedDate);
    const days = Array.from({ length:7 }, (_, index) => addDays(start, index));
    const appointments = sortedAppointments();
    target.innerHTML = `<div class="calendar-shell" style="overflow:auto"><div class="calendar-week-grid">${days.map(day => {
      const key = dateKey(day);
      const dayAppointments = appointments.filter(item => item.date === key);
      return `<section class="calendar-week-day">
        <button class="calendar-week-heading" data-calendar-open-day="${key}"><strong>${day.toLocaleDateString("en-GB", { weekday:"short", day:"numeric" })}</strong><small>${dayAppointments.length} appointment${dayAppointments.length === 1 ? "" : "s"}</small></button>
        <div class="calendar-week-list">
          ${dayAppointments.map(appointment => `<button class="calendar-list-card ${escapeHtml(appointment.status)}" data-appointment-id="${escapeHtml(appointment.id)}"><strong>${escapeHtml(appointment.startTime)} · ${escapeHtml(appointment.clientName)}</strong><small>${escapeHtml(appointment.services.map(segment => segment.serviceName).join(", ") || "No service")}</small>${statusMarkup(appointment.status)}</button>`).join("") || `<button class="calendar-empty" data-calendar-new-date="${key}" data-calendar-new-time="09:00"><span>＋</span>No appointments</button>`}
        </div>
      </section>`;
    }).join("")}</div></div>`;
  }

  function renderMonthView() {
    const target = document.querySelector("#calendarContent");
    const first = startOfMonth(selectedDate);
    const gridStart = addDays(first, -((first.getDay() + 6) % 7));
    const days = Array.from({ length:42 }, (_, index) => addDays(gridStart, index));
    const appointments = sortedAppointments();
    const month = selectedDate.getMonth();
    target.innerHTML = `<div class="calendar-shell"><div class="calendar-month-grid">
      ${["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].map(label => `<div class="calendar-month-weekday">${label}</div>`).join("")}
      ${days.map(day => {
        const key = dateKey(day);
        const dayAppointments = appointments.filter(item => item.date === key);
        const active = dayAppointments.filter(item => !["cancelled","no-show"].includes(item.status));
        const revenue = active.reduce((sum, item) => sum + item.total, 0);
        const classes = [day.getMonth() !== month ? "outside" : "", key === dateKey(new Date()) ? "today" : ""].filter(Boolean).join(" ");
        return `<button class="calendar-month-day ${classes}" data-calendar-open-day="${key}"><strong>${day.getDate()}</strong><span>${dayAppointments.length} appointment${dayAppointments.length === 1 ? "" : "s"}</span><small>${active.length ? money(revenue) : "Available"}</small></button>`;
      }).join("")}
    </div></div>`;
  }

  function renderAgendaView() {
    const target = document.querySelector("#calendarContent");
    const monthStart = dateKey(startOfMonth(selectedDate));
    const monthEnd = dateKey(new Date(selectedDate.getFullYear(), selectedDate.getMonth() + 1, 0));
    const appointments = sortedAppointments().filter(item => item.date >= monthStart && item.date <= monthEnd);
    if (!appointments.length) {
      target.innerHTML = `<button class="calendar-empty" data-calendar-action="new"><span>▦</span><strong>No appointments in ${selectedDate.toLocaleDateString("en-GB", { month:"long" })}</strong><p>Create the first booking for this month.</p></button>`;
      return;
    }
    const grouped = appointments.reduce((output, appointment) => {
      (output[appointment.date] ||= []).push(appointment);
      return output;
    }, {});
    target.innerHTML = `<div class="calendar-agenda">${Object.entries(grouped).map(([date, items]) => `<section class="calendar-agenda-day"><h3>${parseDate(date).toLocaleDateString("en-GB", { weekday:"long", day:"numeric", month:"long" })}</h3>${items.map(appointment => `<button class="calendar-agenda-row" data-appointment-id="${escapeHtml(appointment.id)}"><time>${escapeHtml(appointment.startTime)}–${escapeHtml(appointment.endTime)}</time><div><strong>${escapeHtml(appointment.clientName)}</strong><small>${escapeHtml(appointment.services.map(segment => `${segment.serviceName}${segment.staffName ? ` · ${segment.staffName}` : ""}`).join(" · "))}</small></div>${statusMarkup(appointment.status)}</button>`).join("")}</section>`).join("")}</div>`;
  }

  function defaultSegment(startTime = "09:00", staffId = "") {
    const service = activeCalendarServices()[0];
    const staff = service ? qualifiedStaff(service) : activeTeam();
    const member = memberById(staffId) || staff[0];
    return normaliseSegment({
      serviceId:service?.id || "",
      serviceName:service?.name || "",
      staffId:member?.id || "",
      staffName:member?.name || "",
      startTime,
      duration:Number(service?.duration) || 60,
      price:Number(service?.price) || 0
    });
  }

  function serviceOptions(selectedId) {
    return `<option value="">Choose service</option>${activeCalendarServices().map(service => `<option value="${escapeHtml(service.id)}" ${service.id === selectedId ? "selected" : ""}>${escapeHtml(service.name)} · ${money(service.price)}</option>`).join("")}`;
  }

  function staffOptionsForSegment(segment) {
    const service = serviceById(segment.serviceId);
    const members = service ? qualifiedStaff(service) : activeTeam();
    return `<option value="">Unassigned</option>${members.map(member => `<option value="${escapeHtml(member.id)}" ${member.id === segment.staffId ? "selected" : ""}>${escapeHtml(member.name)} · ${escapeHtml(member.title || "Team member")}</option>`).join("")}`;
  }

  function appointmentTemplate(appointment, defaults) {
    const client = clientById(appointment?.clientId || defaults.clientId);
    const date = appointment?.date || defaults.date || dateKey(selectedDate);
    const status = appointment?.status || "confirmed";
    const source = appointment?.bookingSource || "Telephone";
    return `
      <div class="modal-header"><div><p class="eyebrow">CALENDAR BOOKING</p><h2 id="modalTitle">${appointment ? "Edit appointment" : "New appointment"}</h2></div><button class="icon-button" data-close-modal>×</button></div>
      <form id="appointmentForm" class="appointment-form">
        <div class="modal-body appointment-form">
          <div class="appointment-client-row">
            <label>Client<select id="appointmentClient" required><option value="">Choose client</option>${activeClients().map(item => `<option value="${escapeHtml(item.id)}" ${item.id === client?.id ? "selected" : ""}>${escapeHtml(item.name)}${item.phone ? ` · ${escapeHtml(item.phone)}` : ""}</option>`).join("")}</select></label>
            <button class="secondary-button" id="toggleQuickClient" type="button">＋ Quick client</button>
          </div>
          <div class="quick-client-panel" id="quickClientPanel" hidden>
            <input id="quickClientName" placeholder="Client name" />
            <input id="quickClientPhone" placeholder="Phone" />
            <input id="quickClientEmail" type="email" placeholder="Email" />
            <button class="primary-button" id="saveQuickClient" type="button">Add</button>
          </div>
          <div class="appointment-grid">
            <label>Date<input id="appointmentDate" type="date" required value="${escapeHtml(date)}" /></label>
            <label>Appointment status<select id="appointmentStatus">${Object.entries(STATUS_META).map(([value, meta]) => `<option value="${value}" ${value === status ? "selected" : ""}>${meta.label}</option>`).join("")}</select></label>
            <label>Booking source<select id="appointmentSource">${BOOKING_SOURCES.map(value => `<option ${value === source ? "selected" : ""}>${value}</option>`).join("")}</select></label>
          </div>
          <section class="appointment-service-section">
            <div class="appointment-service-heading"><strong>Services and assigned staff</strong><button class="text-button" id="addAppointmentService" type="button">＋ Add service</button></div>
            <div class="appointment-service-list" id="appointmentServiceList"></div>
          </section>
          <div class="appointment-extra-grid">
            <label>Discount (€)<input id="appointmentDiscount" type="number" min="0" step="0.01" value="${Number(appointment?.discount || 0).toFixed(2)}" /></label>
            <label>Deposit (€)<input id="appointmentDeposit" type="number" min="0" step="0.01" value="${Number(appointment?.deposit || 0).toFixed(2)}" /></label>
            <label>Deposit status<select id="appointmentDepositStatus"><option value="not-paid" ${appointment?.depositStatus !== "paid" ? "selected" : ""}>Not paid</option><option value="paid" ${appointment?.depositStatus === "paid" ? "selected" : ""}>Paid</option></select></label>
            <label>Room / area<input id="appointmentRoom" value="${escapeHtml(appointment?.room || "")}" placeholder="Optional room or station" /></label>
            <label>Reminder<select id="appointmentReminder"><option value="not-sent" ${appointment?.reminderStatus !== "sent" ? "selected" : ""}>Not sent</option><option value="sent" ${appointment?.reminderStatus === "sent" ? "selected" : ""}>Sent</option></select></label>
            <label class="wide">Internal notes<textarea id="appointmentNotes" rows="2" placeholder="Staff-only notes">${escapeHtml(appointment?.notes || "")}</textarea></label>
            <label class="wide">Client-facing notes<textarea id="appointmentClientNotes" rows="2" placeholder="Information to include in a reminder">${escapeHtml(appointment?.clientNotes || "")}</textarea></label>
          </div>
          <div class="appointment-total" id="appointmentTotal"></div>
          <div class="calendar-conflict" id="appointmentConflictPreview" hidden></div>
        </div>
        <div class="modal-footer"><button type="button" class="secondary-button" data-close-modal>Cancel</button><button type="submit" class="primary-button">${appointment ? "Save appointment" : "Create appointment"}</button></div>
      </form>
    `;
  }

  function openDynamicModal(id, html) {
    const template = document.createElement("template");
    template.id = id;
    template.innerHTML = html;
    document.body.append(template);
    openModal(`#${id}`);
    template.remove();
  }

  function openAppointmentModal(appointmentId = null, defaults = {}) {
    ensureCalendarState(state);
    const appointment = appointmentId ? state.appointments.find(item => item.id === appointmentId) : null;
    const baseSegments = appointment?.services?.length
      ? clone(appointment.services)
      : defaults.services?.length
        ? clone(defaults.services)
        : [defaultSegment(defaults.startTime || "09:00", defaults.staffId || "")];
    let draftSegments = baseSegments.map(normaliseSegment);

    openDynamicModal("calendarAppointmentTemplate", appointmentTemplate(appointment, defaults));
    const list = document.querySelector("#appointmentServiceList");

    function updateTotals() {
      const subtotal = draftSegments.reduce((sum, segment) => sum + Math.max(0, Number(segment.price) || 0), 0);
      const discountInput = document.querySelector("#appointmentDiscount");
      const depositInput = document.querySelector("#appointmentDeposit");
      const discount = Math.min(subtotal, Math.max(0, Number(discountInput?.value) || 0));
      const deposit = Math.max(0, Number(depositInput?.value) || 0);
      const total = Math.max(0, subtotal - discount);
      document.querySelector("#appointmentTotal").innerHTML = `<span>Subtotal<strong>${money(subtotal)}</strong></span><span>Discount<strong>− ${money(discount)}</strong></span><span>Appointment total<strong>${money(total)}</strong></span><span>Balance after deposit<strong>${money(Math.max(0, total - deposit))}</strong></span>`;
      previewConflicts();
    }

    function renderSegments() {
      list.innerHTML = draftSegments.map((segment, index) => `
        <div class="appointment-service-row" data-segment-index="${index}">
          <label>Service<select data-segment-field="serviceId">${serviceOptions(segment.serviceId)}</select></label>
          <label>Staff<select data-segment-field="staffId">${staffOptionsForSegment(segment)}</select></label>
          <label>Start<input data-segment-field="startTime" type="time" step="900" value="${escapeHtml(segment.startTime)}" /></label>
          <label>Minutes<input data-segment-field="duration" type="number" min="5" step="5" value="${segment.duration}" /></label>
          <label>Price (€)<input data-segment-field="price" type="number" min="0" step="0.01" value="${Number(segment.price).toFixed(2)}" /></label>
          <button class="remove-appointment-service" type="button" data-remove-segment="${index}" aria-label="Remove service">×</button>
        </div>
      `).join("") || `<div class="calendar-empty"><span>✦</span>Add at least one service.</div>`;
      updateTotals();
    }

    function readSegmentsFromDom() {
      draftSegments = [...list.querySelectorAll("[data-segment-index]")].map(row => {
        const index = Number(row.dataset.segmentIndex);
        const previous = draftSegments[index] || defaultSegment();
        const serviceId = row.querySelector('[data-segment-field="serviceId"]').value;
        const service = serviceById(serviceId);
        const staffId = row.querySelector('[data-segment-field="staffId"]').value;
        const member = memberById(staffId);
        return normaliseSegment({
          ...previous,
          serviceId,
          serviceName:service?.name || previous.serviceName,
          staffId,
          staffName:member?.name || "",
          startTime:row.querySelector('[data-segment-field="startTime"]').value,
          duration:row.querySelector('[data-segment-field="duration"]').value,
          price:row.querySelector('[data-segment-field="price"]').value
        });
      });
    }

    function previewConflicts() {
      const preview = document.querySelector("#appointmentConflictPreview");
      if (!preview) return;
      readSegmentsFromDom();
      const draft = buildAppointmentFromForm(appointment, draftSegments, false);
      const issues = validateAppointment(draft, appointment?.id);
      preview.hidden = issues.length === 0;
      preview.textContent = issues.length ? `Potential scheduling conflict:\n${issues.slice(0, 3).join("\n")}` : "";
    }

    list.addEventListener("change", event => {
      const row = event.target.closest("[data-segment-index]");
      if (!row) return;
      const index = Number(row.dataset.segmentIndex);
      readSegmentsFromDom();
      if (event.target.dataset.segmentField === "serviceId") {
        const service = serviceById(event.target.value);
        if (service) {
          const previousEnd = index ? addMinutes(draftSegments[index - 1].startTime, draftSegments[index - 1].duration) : draftSegments[index].startTime;
          const staff = qualifiedStaff(service);
          draftSegments[index] = normaliseSegment({
            ...draftSegments[index],
            serviceId:service.id,
            serviceName:service.name,
            staffId:staff.some(member => member.id === draftSegments[index].staffId) ? draftSegments[index].staffId : staff[0]?.id || "",
            staffName:staff.find(member => member.id === draftSegments[index].staffId)?.name || staff[0]?.name || "",
            startTime:previousEnd,
            duration:Number(service.duration) || 60,
            price:Number(service.price) || 0
          });
          renderSegments();
          return;
        }
      }
      updateTotals();
    });
    list.addEventListener("input", () => {
      readSegmentsFromDom();
      updateTotals();
    });
    list.addEventListener("click", event => {
      const remove = event.target.closest("[data-remove-segment]");
      if (!remove) return;
      readSegmentsFromDom();
      draftSegments.splice(Number(remove.dataset.removeSegment), 1);
      renderSegments();
    });

    document.querySelector("#addAppointmentService").addEventListener("click", () => {
      readSegmentsFromDom();
      const last = draftSegments[draftSegments.length - 1];
      draftSegments.push(defaultSegment(last ? addMinutes(last.startTime, last.duration) : defaults.startTime || "09:00", last?.staffId || defaults.staffId || ""));
      renderSegments();
    });

    document.querySelector("#toggleQuickClient").addEventListener("click", () => {
      document.querySelector("#quickClientPanel").hidden = !document.querySelector("#quickClientPanel").hidden;
    });
    document.querySelector("#saveQuickClient").addEventListener("click", () => {
      const name = document.querySelector("#quickClientName").value.trim();
      if (!name) return showToast("Client name required", "Enter a client name before adding the record.");
      const existing = (state.clients || []).find(client => client.name.trim().toLowerCase() === name.toLowerCase());
      const client = existing || {
        id:makeCalendarId("cli"),
        name,
        phone:document.querySelector("#quickClientPhone").value.trim(),
        email:document.querySelector("#quickClientEmail").value.trim(),
        preferredServices:"",
        notes:"",
        active:true,
        createdAt:new Date().toISOString()
      };
      if (!existing) state.clients.push(client);
      saveState();
      const select = document.querySelector("#appointmentClient");
      select.innerHTML = `<option value="">Choose client</option>${activeClients().map(item => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}${item.phone ? ` · ${escapeHtml(item.phone)}` : ""}</option>`).join("")}`;
      select.value = client.id;
      document.querySelector("#quickClientPanel").hidden = true;
      showToast(existing ? "Existing client selected" : "Client added", `${client.name} is ready for this appointment.`);
    });

    ["appointmentDiscount","appointmentDeposit"].forEach(id => document.querySelector(`#${id}`).addEventListener("input", updateTotals));
    document.querySelector("#appointmentDate").addEventListener("change", previewConflicts);

    document.querySelector("#appointmentForm").addEventListener("submit", event => {
      event.preventDefault();
      readSegmentsFromDom();
      const next = buildAppointmentFromForm(appointment, draftSegments, true);
      if (!next.clientId) return showToast("Choose a client", "Select or quickly add a client before saving the appointment.");
      if (!next.services.length || next.services.some(segment => !segment.serviceId)) return showToast("Choose the services", "Every appointment line must have a service.");
      if (next.services.some(segment => !segment.staffId)) return showToast("Assign the staff", "Every appointment service must have an assigned team member.");
      const issues = validateAppointment(next, appointment?.id);
      if (issues.length) {
        const alternatives = findAlternatives(next.services[0]?.staffId, next.date, next.services[0]?.duration || 60, appointment?.id);
        const detail = `${issues.join("\n")}${alternatives.length ? `\n\nSuggested available times: ${alternatives.join(", ")}` : ""}\n\nSave this appointment anyway?`;
        if (!window.confirm(detail)) return;
        next.conflictOverride = true;
      }
      if (appointment) Object.assign(appointment, next, { id:appointment.id, createdAt:appointment.createdAt, updatedAt:new Date().toISOString() });
      else state.appointments.push(next);
      state.activities.unshift({
        type:"appointment",
        title:`Appointment ${appointment ? "updated" : "created"} for ${next.clientName}`,
        detail:`${next.date} · ${next.startTime} · ${next.services.map(segment => segment.serviceName).join(", ")}`,
        date:new Date().toISOString()
      });
      saveState();
      renderAll();
      closeModal();
      selectedDate = parseDate(next.date);
      viewMode = window.innerWidth <= 720 ? "agenda" : "day";
      originalSwitchView("calendar");
      renderCalendar();
      showToast(appointment ? "Appointment updated" : "Appointment created", `${next.clientName} is scheduled for ${next.date} at ${next.startTime}.`);
    });

    renderSegments();
  }

  function buildAppointmentFromForm(existing, segments, includeIds) {
    const clientId = document.querySelector("#appointmentClient")?.value || "";
    const client = clientById(clientId);
    const sorted = segments.map(normaliseSegment).sort((a, b) => minutesFromTime(a.startTime) - minutesFromTime(b.startTime));
    const subtotal = sorted.reduce((sum, segment) => sum + segment.price, 0);
    const discount = Math.min(subtotal, Math.max(0, Number(document.querySelector("#appointmentDiscount")?.value) || 0));
    const startTime = sorted[0]?.startTime || "09:00";
    const endMinutes = sorted.reduce((maximum, segment) => Math.max(maximum, minutesFromTime(segment.startTime) + segment.duration), minutesFromTime(startTime));
    return normaliseAppointment({
      id:includeIds ? existing?.id || makeCalendarId("APT") : existing?.id || "preview",
      clientId,
      clientName:client?.name || "Walk-in",
      date:document.querySelector("#appointmentDate")?.value || dateKey(selectedDate),
      startTime,
      endTime:timeFromMinutes(endMinutes),
      status:document.querySelector("#appointmentStatus")?.value || "confirmed",
      bookingSource:document.querySelector("#appointmentSource")?.value || "Telephone",
      services:sorted,
      subtotal,
      discount,
      total:subtotal - discount,
      deposit:Number(document.querySelector("#appointmentDeposit")?.value) || 0,
      depositStatus:document.querySelector("#appointmentDepositStatus")?.value || "not-paid",
      room:document.querySelector("#appointmentRoom")?.value || "",
      notes:document.querySelector("#appointmentNotes")?.value || "",
      clientNotes:document.querySelector("#appointmentClientNotes")?.value || "",
      reminderStatus:document.querySelector("#appointmentReminder")?.value || "not-sent",
      saleId:existing?.saleId || null,
      createdAt:existing?.createdAt || new Date().toISOString(),
      updatedAt:new Date().toISOString()
    });
  }

  function segmentIssues(segment, appointmentDate, excludingId, ownSegments) {
    const issues = [];
    const service = serviceById(segment.serviceId);
    const staff = memberById(segment.staffId);
    const start = minutesFromTime(segment.startTime);
    const end = start + Number(segment.duration || 0);
    if (!staff) issues.push(`${segment.serviceName}: no staff member is assigned.`);
    if (service?.staffIds?.length && segment.staffId && !service.staffIds.includes(segment.staffId)) {
      issues.push(`${staff?.name || "Selected staff"} is not qualified for ${service.name}.`);
    }
    if (staff) {
      const schedule = staffSchedule(staff.id, appointmentDate);
      if (!schedule.enabled || start < minutesFromTime(schedule.start) || end > minutesFromTime(schedule.end)) {
        issues.push(`${staff.name} is outside working hours for ${appointmentDate}.`);
      }
      const block = (state.calendarSettings.blocks || []).find(item =>
        item.staffId === staff.id &&
        item.date === appointmentDate &&
        intervalsOverlap(start, end, minutesFromTime(item.startTime), minutesFromTime(item.endTime))
      );
      if (block) issues.push(`${staff.name} is blocked for ${block.reason} (${block.startTime}–${block.endTime}).`);

      const conflict = (state.appointments || []).find(appointment =>
        appointment.id !== excludingId &&
        appointment.date === appointmentDate &&
        !["cancelled","no-show"].includes(appointment.status) &&
        appointment.services.some(other => other.staffId === staff.id && intervalsOverlap(start, end, minutesFromTime(other.startTime), minutesFromTime(other.startTime) + Number(other.duration || 0)))
      );
      if (conflict) issues.push(`${staff.name} is already booked with ${conflict.clientName} at ${conflict.startTime}.`);
    }
    const internalConflict = ownSegments.find(other =>
      other.id !== segment.id &&
      segment.staffId &&
      other.staffId === segment.staffId &&
      intervalsOverlap(start, end, minutesFromTime(other.startTime), minutesFromTime(other.startTime) + Number(other.duration || 0))
    );
    if (internalConflict) issues.push(`${staff?.name || "The selected staff member"} has overlapping services within this appointment.`);
    return issues;
  }

  function validateAppointment(appointment, excludingId = null) {
    const issues = appointment.services.flatMap(segment => segmentIssues(segment, appointment.date, excludingId, appointment.services));
    return [...new Set(issues)];
  }

  function isStaffFree(staffId, date, start, duration, excludingId = null) {
    const segment = normaliseSegment({ id:"probe", serviceId:"", serviceName:"Appointment", staffId, startTime:start, duration, price:0 });
    const fake = [segment];
    const issues = segmentIssues(segment, date, excludingId, fake).filter(issue => !issue.includes("not qualified"));
    return issues.length === 0;
  }

  function findAlternatives(staffId, date, duration, excludingId) {
    if (!staffId) return [];
    const schedule = staffSchedule(staffId, date);
    if (!schedule.enabled) return [];
    const output = [];
    for (let minute = minutesFromTime(schedule.start); minute + duration <= minutesFromTime(schedule.end); minute += 15) {
      const time = timeFromMinutes(minute);
      if (isStaffFree(staffId, date, time, duration, excludingId)) output.push(time);
      if (output.length === 3) break;
    }
    return output;
  }

  function detailTemplate(appointment) {
    const client = clientById(appointment.clientId);
    const status = STATUS_META[appointment.status] || STATUS_META.confirmed;
    return `
      <div class="modal-header"><div><p class="eyebrow">APPOINTMENT DETAILS</p><h2 id="modalTitle">${escapeHtml(appointment.clientName)}</h2></div><button class="icon-button" data-close-modal>×</button></div>
      <div class="modal-body appointment-form">
        <div class="appointment-detail-grid">
          <div><small>Date</small><strong>${parseDate(appointment.date).toLocaleDateString("en-GB", { weekday:"short", day:"numeric", month:"long", year:"numeric" })}</strong></div>
          <div><small>Time</small><strong>${escapeHtml(appointment.startTime)}–${escapeHtml(appointment.endTime)}</strong></div>
          <div><small>Status</small><strong>${escapeHtml(status.label)}</strong></div>
          <div><small>Client contact</small><strong>${escapeHtml(client?.phone || client?.email || "No contact saved")}</strong></div>
          <div><small>Booking source</small><strong>${escapeHtml(appointment.bookingSource)}</strong></div>
          <div><small>Total / deposit</small><strong>${money(appointment.total)} · ${money(appointment.deposit)} deposit</strong></div>
        </div>
        <div class="appointment-detail-services">${appointment.services.map(segment => `<div class="appointment-detail-service"><time>${escapeHtml(segment.startTime)}</time><div><strong>${escapeHtml(segment.serviceName)}</strong><small>${escapeHtml(segment.staffName || "Unassigned")} · ${segment.duration} minutes</small></div><strong>${money(segment.price)}</strong></div>`).join("")}</div>
        ${appointment.notes || appointment.clientNotes ? `<div class="calendar-conflict" style="border-color:#dce5e1;background:#f8fbfa;color:#526a62"><strong>Notes</strong><br>${escapeHtml(appointment.notes || appointment.clientNotes)}</div>` : ""}
        <div class="appointment-detail-actions">
          <button class="secondary-button" data-appointment-action="edit">Edit / reschedule</button>
          <button class="secondary-button" data-appointment-action="duplicate">Duplicate</button>
          ${appointment.status === "tentative" ? `<button class="secondary-button" data-appointment-action="confirmed">Confirm</button>` : ""}
          ${appointment.status === "confirmed" ? `<button class="secondary-button" data-appointment-action="checked-in">Check in</button>` : ""}
          ${appointment.status === "checked-in" ? `<button class="secondary-button" data-appointment-action="in-progress">Start</button>` : ""}
          ${!["completed","cancelled","no-show"].includes(appointment.status) ? `<button class="secondary-button" data-appointment-action="completed">Complete</button><button class="secondary-button" data-appointment-action="cancelled">Cancel</button><button class="secondary-button" data-appointment-action="no-show">No-show</button>` : ""}
          ${appointment.status === "completed" && !appointment.saleId ? `<button class="primary-button" data-appointment-action="sale">Create sale</button>` : ""}
          ${appointment.saleId ? `<button class="secondary-button" data-appointment-action="sale-existing">Sale ${escapeHtml(appointment.saleId)}</button>` : ""}
          <button class="danger-secondary-button" data-appointment-action="delete">Delete appointment</button>
        </div>
      </div>
      <div class="modal-footer"><button class="secondary-button" data-close-modal>Close</button></div>
    `;
  }

  function openAppointmentDetails(id) {
    const appointment = state.appointments.find(item => item.id === id);
    if (!appointment) return;
    openDynamicModal("calendarDetailTemplate", detailTemplate(appointment));
    document.querySelector(".appointment-detail-actions").addEventListener("click", event => {
      const button = event.target.closest("[data-appointment-action]");
      if (!button) return;
      const action = button.dataset.appointmentAction;
      if (action === "edit") {
        closeModal();
        openAppointmentModal(appointment.id);
        return;
      }
      if (action === "duplicate") {
        const copy = clone(appointment);
        copy.services = copy.services.map(segment => ({ ...segment, id:makeCalendarId("seg") }));
        closeModal();
        openAppointmentModal(null, { date:appointment.date, startTime:appointment.startTime, clientId:appointment.clientId, services:copy.services });
        document.querySelector("#appointmentClient").value = appointment.clientId;
        return;
      }
      if (["confirmed","checked-in","in-progress","completed","cancelled","no-show"].includes(action)) {
        appointment.status = action;
        appointment.updatedAt = new Date().toISOString();
        saveState();
        renderAll();
        closeModal();
        showToast("Appointment updated", `${appointment.clientName} is now marked ${STATUS_META[action].label.toLowerCase()}.`);
        return;
      }
      if (action === "sale") {
        closeModal();
        convertAppointmentToSale(appointment);
        return;
      }
      if (action === "sale-existing") {
        closeModal();
        originalSwitchView("sales");
        return;
      }
      if (action === "delete") {
        if (!window.confirm(`Delete the appointment for ${appointment.clientName} on ${appointment.date}? Cancellation is usually preferable because it preserves history.`)) return;
        state.appointments = state.appointments.filter(item => item.id !== appointment.id);
        saveState();
        renderAll();
        closeModal();
        showToast("Appointment deleted", "The appointment record was permanently removed.");
      }
    });
  }

  function convertAppointmentToSale(appointment) {
    if (typeof setupSaleModal !== "function") return showToast("Sales unavailable", "The sales module is not ready.");
    const grouped = new Map();
    appointment.services.forEach(segment => {
      const key = `${segment.serviceId}:${segment.staffId}`;
      const current = grouped.get(key);
      if (current) current.qty += 1;
      else grouped.set(key, {
        itemType:"service",
        itemId:segment.serviceId,
        qty:1,
        staff:segment.staffName || "",
        lineDiscount:0,
        unitPrice:Number(segment.price) || 0,
        name:segment.serviceName,
        duration:Number(segment.duration) || 0,
        vatRate:Number(serviceById(segment.serviceId)?.vatRate) || 0,
        category:serviceById(segment.serviceId)?.category || "Other"
      });
    });
    const existingSaleIds = new Set((state.sales || []).map(item => item.id));
    pendingAppointmentSale = { appointmentId:appointment.id, deposit:appointment.depositStatus === "paid" ? Math.min(appointment.total, appointment.deposit) : 0, existingSaleIds };
    setupSaleModal();
    saleBasket = [...grouped.values()];
    saleBasketDiscount = Math.max(0, Number(appointment.discount) || 0);
    renderSaleBasket();
    const clientSelect = document.querySelector("#saleClient");
    if (clientSelect) clientSelect.value = appointment.clientId || "";

    const finder = document.querySelector("#saleBuildStep .sale-finder");
    finder?.insertAdjacentHTML("beforebegin", `<div class="calendar-sale-deposit"><strong>Appointment ${escapeHtml(appointment.id)}</strong><br>${pendingAppointmentSale.deposit ? `${money(pendingAppointmentSale.deposit)} deposit already paid. The sale retains full revenue and the checkout balance will show the remaining amount.` : "No paid deposit is recorded for this appointment."}</div>`);

    const summary = document.querySelector("#checkoutSummary");
    if (summary) {
      const decorate = () => {
        if (!pendingAppointmentSale || !document.querySelector("#checkoutSummary")) return;
        const totals = getCheckoutTotals();
        const deposit = Math.min(totals.total, pendingAppointmentSale.deposit);
        document.querySelector("#checkoutSummary .calendar-deposit-row")?.remove();
        const totalRow = document.querySelector("#checkoutSummary .checkout-total");
        totalRow?.insertAdjacentHTML("beforebegin", `<div class="calendar-deposit-row"><span>Deposit already paid</span><strong>− ${money(deposit)}</strong></div>`);
        if (totalRow) {
          const label = totalRow.querySelector("span");
          const value = totalRow.querySelector("strong");
          if (label) label.textContent = "Remaining amount due";
          if (value) value.textContent = money(Math.max(0, totals.total - deposit));
        }
      };
      let observer;
      const decorateSafely = () => {
        observer?.disconnect();
        decorate();
        observer?.observe(summary, { childList:true, subtree:true });
      };
      observer = new MutationObserver(decorateSafely);
      observer.observe(summary, { childList:true, subtree:true });
      decorateSafely();
    }

    document.querySelector("#completeSale")?.addEventListener("click", () => {
      const context = pendingAppointmentSale;
      if (!context) return;
      setTimeout(() => {
        const savedSale = (state.sales || []).find(item => !context.existingSaleIds.has(item.id));
        const targetAppointment = state.appointments.find(item => item.id === context.appointmentId);
        if (!savedSale || !targetAppointment) return;
        savedSale.appointmentId = targetAppointment.id;
        savedSale.deposit = context.deposit;
        savedSale.amountDue = Math.max(0, Number(savedSale.total || 0) - context.deposit);
        savedSale.clientId = targetAppointment.clientId;
        savedSale.clientName = targetAppointment.clientName;
        targetAppointment.saleId = savedSale.id;
        targetAppointment.status = "completed";
        targetAppointment.updatedAt = new Date().toISOString();
        saveState();
        renderAll();
        pendingAppointmentSale = null;
      }, 0);
    }, true);
  }

  function openWorkingHoursModal() {
    const members = activeTeam();
    if (!members.length) return showToast("No team members", "Add a team member before setting working hours.");
    const first = filters.staff !== "all" && memberById(filters.staff) ? filters.staff : members[0].id;
    openDynamicModal("calendarHoursTemplate", `
      <div class="modal-header"><div><p class="eyebrow">STAFF AVAILABILITY</p><h2 id="modalTitle">Working hours</h2></div><button class="icon-button" data-close-modal>×</button></div>
      <div class="modal-body appointment-form">
        <label>Team member<select id="scheduleStaff">${members.map(member => `<option value="${escapeHtml(member.id)}" ${member.id === first ? "selected" : ""}>${escapeHtml(member.name)}</option>`).join("")}</select></label>
        <div class="calendar-schedule-list" id="calendarScheduleList"></div>
        <div class="calendar-block-list" id="calendarBlockList"></div>
      </div>
      <div class="modal-footer"><button class="secondary-button" data-close-modal>Cancel</button><button class="primary-button" id="saveWorkingHours">Save working hours</button></div>
    `);
    const staffSelect = document.querySelector("#scheduleStaff");
    const list = document.querySelector("#calendarScheduleList");
    const blocks = document.querySelector("#calendarBlockList");

    function renderHours() {
      const staffId = staffSelect.value;
      const week = state.calendarSettings.staffSchedules[staffId]?.week || defaultWeek();
      list.innerHTML = WEEKDAY_LABELS.map((label, day) => {
        const value = week[day] || { enabled:false, start:"09:00", end:"17:00" };
        return `<div class="calendar-schedule-row" data-schedule-day="${day}"><input type="checkbox" data-schedule-enabled ${value.enabled ? "checked" : ""} /><span>${label}</span><label>Start<input data-schedule-start type="time" value="${value.start}" /></label><label>End<input data-schedule-end type="time" value="${value.end}" /></label></div>`;
      }).join("");
      const memberBlocks = (state.calendarSettings.blocks || []).filter(block => block.staffId === staffId).sort((a, b) => `${a.date}${a.startTime}`.localeCompare(`${b.date}${b.startTime}`)).slice(0, 12);
      blocks.innerHTML = memberBlocks.length ? `<strong>Upcoming blocked periods</strong>${memberBlocks.map(block => `<div class="calendar-block-item"><div><strong>${escapeHtml(block.reason)}</strong><small>${escapeHtml(block.date)} · ${escapeHtml(block.startTime)}–${escapeHtml(block.endTime)}</small></div><button class="delete-record-button" data-delete-calendar-block="${escapeHtml(block.id)}">Delete</button></div>`).join("")}` : "";
    }

    staffSelect.addEventListener("change", renderHours);
    blocks.addEventListener("click", event => {
      const button = event.target.closest("[data-delete-calendar-block]");
      if (!button) return;
      state.calendarSettings.blocks = state.calendarSettings.blocks.filter(block => block.id !== button.dataset.deleteCalendarBlock);
      saveState();
      renderHours();
      renderCalendar();
    });
    document.querySelector("#saveWorkingHours").addEventListener("click", () => {
      const staffId = staffSelect.value;
      const week = {};
      list.querySelectorAll("[data-schedule-day]").forEach(row => {
        week[row.dataset.scheduleDay] = {
          enabled:row.querySelector("[data-schedule-enabled]").checked,
          start:row.querySelector("[data-schedule-start]").value || "09:00",
          end:row.querySelector("[data-schedule-end]").value || "17:00"
        };
      });
      state.calendarSettings.staffSchedules[staffId] = { week };
      saveState();
      renderAll();
      closeModal();
      showToast("Working hours saved", `${memberById(staffId)?.name || "The team member"}'s weekly availability was updated.`);
    });
    renderHours();
  }

  function openBlockTimeModal(defaults = {}) {
    const members = activeTeam();
    if (!members.length) return showToast("No team members", "Add a team member before blocking time.");
    openDynamicModal("calendarBlockTemplate", `
      <div class="modal-header"><div><p class="eyebrow">STAFF AVAILABILITY</p><h2 id="modalTitle">Block time</h2></div><button class="icon-button" data-close-modal>×</button></div>
      <form id="calendarBlockForm">
        <div class="modal-body form-grid">
          <label class="wide">Team member<select name="staffId">${members.map(member => `<option value="${escapeHtml(member.id)}" ${member.id === defaults.staffId ? "selected" : ""}>${escapeHtml(member.name)}</option>`).join("")}</select></label>
          <label>Date<input name="date" type="date" required value="${escapeHtml(defaults.date || dateKey(selectedDate))}" /></label>
          <label>Start<input name="startTime" type="time" required value="${escapeHtml(defaults.startTime || "12:00")}" /></label>
          <label>End<input name="endTime" type="time" required value="${escapeHtml(defaults.endTime || "13:00")}" /></label>
          <label class="wide">Reason<input name="reason" required placeholder="Lunch break, annual leave, training…" value="${escapeHtml(defaults.reason || "")}" /></label>
        </div>
        <div class="modal-footer"><button class="secondary-button" type="button" data-close-modal>Cancel</button><button class="primary-button" type="submit">Block time</button></div>
      </form>
    `);
    document.querySelector("#calendarBlockForm").addEventListener("submit", event => {
      event.preventDefault();
      const values = Object.fromEntries(new FormData(event.target));
      if (minutesFromTime(values.endTime) <= minutesFromTime(values.startTime)) return showToast("Invalid blocked time", "The end time must be later than the start time.");
      state.calendarSettings.blocks.push({
        id:makeCalendarId("block"),
        staffId:values.staffId,
        date:values.date,
        startTime:values.startTime,
        endTime:values.endTime,
        reason:String(values.reason || "Unavailable").trim()
      });
      saveState();
      renderAll();
      closeModal();
      showToast("Time blocked", `${memberById(values.staffId)?.name || "The team member"} is unavailable on ${values.date}.`);
    });
  }

  function deleteBlock(id) {
    const block = state.calendarSettings.blocks.find(item => item.id === id);
    if (!block) return;
    if (!window.confirm(`Remove the blocked period "${block.reason}" on ${block.date}?`)) return;
    state.calendarSettings.blocks = state.calendarSettings.blocks.filter(item => item.id !== id);
    saveState();
    renderAll();
    showToast("Blocked time removed", "The staff member is available again for that period.");
  }

  function movePeriod(direction) {
    if (viewMode === "day") selectedDate = addDays(selectedDate, direction);
    if (viewMode === "week") selectedDate = addDays(selectedDate, direction * 7);
    if (["month","agenda"].includes(viewMode)) selectedDate = new Date(selectedDate.getFullYear(), selectedDate.getMonth() + direction, 1);
    renderCalendar();
  }

  function wireCalendarEvents() {
    document.querySelectorAll('[data-view="calendar"]').forEach(button => button.addEventListener("click", () => switchView("calendar")));
    document.querySelector("#calendarView").addEventListener("click", event => {
      const action = event.target.closest("[data-calendar-action]");
      if (action) {
        const value = action.dataset.calendarAction;
        if (value === "new") openAppointmentModal(null, { date:dateKey(selectedDate), startTime:"09:00" });
        if (value === "working-hours") openWorkingHoursModal();
        if (value === "block-time") openBlockTimeModal();
        if (value === "previous") movePeriod(-1);
        if (value === "next") movePeriod(1);
        if (value === "today") { selectedDate = startOfDay(new Date()); renderCalendar(); }
      }
      const appointment = event.target.closest("[data-appointment-id]");
      if (appointment) openAppointmentDetails(appointment.dataset.appointmentId);
      const newSlot = event.target.closest("[data-calendar-new-date]");
      if (newSlot) openAppointmentModal(null, { date:newSlot.dataset.calendarNewDate, startTime:newSlot.dataset.calendarNewTime || "09:00", staffId:newSlot.dataset.calendarNewStaff || "" });
      const openDay = event.target.closest("[data-calendar-open-day]");
      if (openDay) {
        selectedDate = parseDate(openDay.dataset.calendarOpenDay);
        viewMode = "day";
        renderCalendar();
      }
      const block = event.target.closest("[data-calendar-block-id]");
      if (block) deleteBlock(block.dataset.calendarBlockId);
    });
    document.querySelectorAll("[data-calendar-mode]").forEach(button => button.addEventListener("click", () => {
      viewMode = button.dataset.calendarMode;
      localStorage.setItem("vanita-calendar-view", viewMode);
      renderCalendar();
    }));
    document.querySelector("#calendarSearch").addEventListener("input", event => { filters.query = event.target.value; renderCalendar(); });
    document.querySelector("#calendarStaffFilter").addEventListener("change", event => { filters.staff = event.target.value; renderCalendar(); });
    document.querySelector("#calendarStatusFilter").addEventListener("change", event => { filters.status = event.target.value; renderCalendar(); });
  }

  function extendSettingsIntegration() {
    const observer = new MutationObserver(() => {
      const list = document.querySelector("#resetAreaList");
      if (list && !list.querySelector('[data-reset-area="appointments"]')) {
        const count = (state.appointments || []).length;
        list.insertAdjacentHTML("beforeend", `<label class="reset-area-option"><input type="checkbox" data-reset-area="appointments" /><span><strong>Appointments</strong><small>Deletes all appointment records. Staff working hours and blocked periods remain available.</small></span><em>${count} record${count === 1 ? "" : "s"}</em></label>`);
      }
      const file = document.querySelector("#restoreBackupFile");
      if (file && file.dataset.calendarRestoreHook !== "true") {
        file.dataset.calendarRestoreHook = "true";
        file.addEventListener("change", async () => {
          pendingRestoreAppointments = null;
          const selected = file.files?.[0];
          if (!selected) return;
          try {
            const parsed = JSON.parse(await selected.text());
            const imported = parsed?.schema === "vanita-stock-backup" ? parsed.state : parsed;
            pendingRestoreAppointments = Array.isArray(imported?.appointments) ? imported.appointments.map(normaliseAppointment) : [];
            setTimeout(() => {
              const counts = document.querySelector("#restoreCounts");
              if (counts && !counts.querySelector("[data-calendar-restore-count]")) counts.insertAdjacentHTML("beforeend", `<div data-calendar-restore-count><strong>${pendingRestoreAppointments.length}</strong><span>Appointments</span></div>`);
            }, 0);
          } catch {}
        });
      }
    });
    observer.observe(document.body, { childList:true, subtree:true });

    document.addEventListener("click", event => {
      const reset = event.target.closest("#applyReset");
      if (reset) {
        const resetAppointments = document.querySelector('[data-reset-area="appointments"]')?.checked === true;
        if (resetAppointments) setTimeout(() => {
          state.appointments = [];
          saveState();
          renderAll();
        }, 20);
      }
      const restore = event.target.closest("#applyRestore");
      if (restore) {
        const mode = document.querySelector('input[name="restoreMode"]:checked')?.value || "replace";
        const incoming = clone(pendingRestoreAppointments || []);
        if (mode === "merge" && incoming.length) setTimeout(() => {
          const known = new Set((state.appointments || []).map(item => item.id));
          incoming.forEach(item => { if (!known.has(item.id)) state.appointments.push(normaliseAppointment(item)); });
          saveState();
          renderAll();
          pendingRestoreAppointments = null;
        }, 60);
      }
    }, true);
  }

  function startCalendarGuide() {
    closeCalendarGuide();
    const steps = [
      { target:"#calendarView .calendar-page-heading", title:"Calendar workspace", text:"This tab brings appointments, staff availability and service scheduling together." },
      { target:"#calendarView [data-calendar-action='new']", title:"Create an appointment", text:"Add a client, one or more services, qualified staff, deposits and booking notes." },
      { target:"#calendarView .calendar-toolbar", title:"Change the date and view", text:"Move through the schedule and switch between Day, Week, Month and Agenda views." },
      { target:"#calendarView .calendar-filters", title:"Search and filters", text:"Find bookings by client, service, staff or notes, then filter by staff member or appointment status." },
      { target:"#calendarContent", title:"Appointment schedule", text:"Click an appointment to edit, reschedule, update its status or convert it into a completed sale." },
      { target:"#calendarView [data-calendar-action='working-hours']", title:"Staff availability", text:"Set weekly working hours and add blocked periods for leave, breaks, training or other unavailable time." }
    ].map(step => ({ ...step, element:document.querySelector(step.target) })).filter(step => step.element);
    if (!steps.length) return;
    let index = 0;
    calendarGuide = document.createElement("div");
    calendarGuide.className = "calendar-guide";
    calendarGuide.innerHTML = `<div class="calendar-guide-target"></div><section class="calendar-guide-bubble"><button class="calendar-guide-close" aria-label="Close">×</button><h2></h2><p></p><div class="calendar-guide-footer"><button data-guide-previous>←</button><span></span><button data-guide-next>→</button></div></section>`;
    document.body.append(calendarGuide);
    const target = calendarGuide.querySelector(".calendar-guide-target");
    const bubble = calendarGuide.querySelector(".calendar-guide-bubble");

    function show() {
      const step = steps[index];
      step.element.scrollIntoView({ block:"center", behavior:"smooth" });
      setTimeout(() => {
        const rect = step.element.getBoundingClientRect();
        target.style.left = `${Math.max(6, rect.left - 5)}px`;
        target.style.top = `${Math.max(6, rect.top - 5)}px`;
        target.style.width = `${Math.min(window.innerWidth - 12, rect.width + 10)}px`;
        target.style.height = `${Math.min(window.innerHeight - 12, rect.height + 10)}px`;
        bubble.querySelector("h2").textContent = step.title;
        bubble.querySelector("p").textContent = step.text;
        bubble.querySelector(".calendar-guide-footer span").textContent = `${index + 1}/${steps.length}`;
        bubble.querySelector("[data-guide-previous]").disabled = index === 0;
        bubble.querySelector("[data-guide-next]").disabled = index === steps.length - 1;
        const bubbleWidth = Math.min(360, window.innerWidth - 28);
        const left = Math.max(14, Math.min(window.innerWidth - bubbleWidth - 14, rect.left + rect.width / 2 - bubbleWidth / 2));
        let top = rect.bottom + 16;
        if (top + 210 > window.innerHeight) top = Math.max(14, rect.top - 210);
        bubble.style.left = `${left}px`;
        bubble.style.top = `${top}px`;
      }, 220);
    }
    calendarGuide.querySelector(".calendar-guide-close").addEventListener("click", closeCalendarGuide);
    calendarGuide.querySelector("[data-guide-previous]").addEventListener("click", () => { if (index > 0) { index--; show(); } });
    calendarGuide.querySelector("[data-guide-next]").addEventListener("click", () => { if (index < steps.length - 1) { index++; show(); } });
    show();
  }

  function closeCalendarGuide() {
    calendarGuide?.remove();
    calendarGuide = null;
  }

  function installGuideHook() {
    let button = document.querySelector("#openGuide");
    if (!button) return;
    if (button.dataset.contextGuideInstalled === "true" && window.VanitaQuickGuide?.open) {
      const replacement = button.cloneNode(true);
      button.replaceWith(replacement);
      button = replacement;
      button.dataset.calendarGuideRouter = "true";
      button.addEventListener("click", event => {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (document.querySelector("#calendarView")?.classList.contains("active")) startCalendarGuide();
        else window.VanitaQuickGuide.open();
      }, true);
      return;
    }
    button.addEventListener("click", event => {
      if (!document.querySelector("#calendarView")?.classList.contains("active")) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      startCalendarGuide();
    }, true);
  }

  function install() {
    if (
      typeof state === "undefined" ||
      typeof normalizeState !== "function" ||
      typeof renderAll !== "function" ||
      typeof switchView !== "function" ||
      typeof openModal !== "function" ||
      typeof closeModal !== "function" ||
      typeof saveState !== "function" ||
      typeof setupSaleModal !== "function" ||
      typeof renderSaleBasket !== "function" ||
      typeof getCheckoutTotals !== "function" ||
      !window.__vanitaContactsInstalled ||
      !window.__vanitaServiceTeamInstalled ||
      !document.querySelector(".main-nav") ||
      !document.querySelector(".mobile-nav")
    ) {
      setTimeout(install, 35);
      return;
    }
    if (window.__vanitaCalendarInstalled) return;
    window.__vanitaCalendarInstalled = true;

    originalNormalizeState = normalizeState;
    originalRenderAll = renderAll;
    originalSwitchView = switchView;

    normalizeState = function (data) {
      return ensureCalendarState(originalNormalizeState(data));
    };
    ensureCalendarState(state);

    injectInterface();
    wireCalendarEvents();
    extendSettingsIntegration();
    installGuideHook();

    renderAll = function () {
      ensureCalendarState(state);
      originalRenderAll();
      renderCalendar();
    };
    switchView = function (view) {
      originalSwitchView(view);
      if (view === "calendar") renderCalendar();
    };

    const storedMode = localStorage.getItem("vanita-calendar-view");
    if (["day","week","month","agenda"].includes(storedMode)) viewMode = storedMode;
    renderCalendar();

    window.VanitaCalendar = {
      openAppointment:openAppointmentModal,
      openDetails:openAppointmentDetails,
      render:renderCalendar,
      release:RELEASE
    };
  }

  install();
})();