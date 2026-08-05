"use client";

import { useMemo, useState } from "react";
import {
  AlertCircle,
  CalendarCheck2,
  CalendarDays,
  Clock3,
  Plus,
  Search,
  Sparkles,
  UserRoundCheck,
} from "lucide-react";
import { useBdb } from "@/lib/store";
import { Badge, Button, Card, Dialog, PageHeader, StatCard } from "@/components/ui";
import styles from "../department.module.css";

type TimesheetFilter = "all" | "pending" | "approved" | "exception";

type PreviewTimesheet = {
  employee: string;
  role: string;
  period: string;
  scheduledHours: number;
  recordedHours: number;
  overtimeHours: number;
  source: "Clock entries" | "Manual draft" | "Calendar derived";
  status: "Pending approval" | "Approved" | "Exception";
};

const previewTimesheets: PreviewTimesheet[] = [
  {
    employee: "Vanita Workspace Owner",
    role: "Owner · Senior therapist",
    period: "20–26 Jul 2026",
    scheduledHours: 40,
    recordedHours: 38.5,
    overtimeHours: 0,
    source: "Clock entries",
    status: "Pending approval",
  },
  {
    employee: "Maya Camilleri",
    role: "Therapist",
    period: "20–26 Jul 2026",
    scheduledHours: 37.5,
    recordedHours: 39,
    overtimeHours: 1.5,
    source: "Calendar derived",
    status: "Approved",
  },
  {
    employee: "Leah Vella",
    role: "Reception and operations",
    period: "20–26 Jul 2026",
    scheduledHours: 32,
    recordedHours: 27.5,
    overtimeHours: 0,
    source: "Manual draft",
    status: "Exception",
  },
  {
    employee: "Daniel Borg",
    role: "Part-time therapist",
    period: "20–26 Jul 2026",
    scheduledHours: 18,
    recordedHours: 18,
    overtimeHours: 0,
    source: "Clock entries",
    status: "Approved",
  },
];

const toneByStatus = {
  "Pending approval": "gold",
  Approved: "green",
  Exception: "red",
} as const;

export default function TimesheetsPage() {
  const { role } = useBdb();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<TimesheetFilter>("all");
  const [entryOpen, setEntryOpen] = useState(false);
  const supportMode = role === "platform-support";

  const visibleRows = useMemo(() => {
    const term = query.trim().toLowerCase();
    return previewTimesheets.filter((row) => {
      const matchesQuery = !term || [row.employee, row.role, row.period, row.source, row.status]
        .join(" ")
        .toLowerCase()
        .includes(term);
      const matchesFilter = filter === "all"
        || (filter === "pending" && row.status === "Pending approval")
        || (filter === "approved" && row.status === "Approved")
        || (filter === "exception" && row.status === "Exception");
      return matchesQuery && matchesFilter;
    });
  }, [filter, query]);

  const totalScheduled = previewTimesheets.reduce((total, row) => total + row.scheduledHours, 0);
  const totalRecorded = previewTimesheets.reduce((total, row) => total + row.recordedHours, 0);
  const pendingCount = previewTimesheets.filter((row) => row.status === "Pending approval").length;
  const exceptionCount = previewTimesheets.filter((row) => row.status === "Exception").length;

  return (
    <>
      <PageHeader
        eyebrow="Calendar department · Workforce draft"
        title="Timesheets"
        description="Review scheduled time, recorded attendance and approval exceptions without turning Calendar into a payroll ledger."
        action={(
          <div className={styles.headerActions}>
            <Button variant="secondary" disabled title="Export will be connected after the timesheet schema is approved">
              Export period
            </Button>
            <Button onClick={() => setEntryOpen(true)}>
              <Plus size={17} /> Add time entry
            </Button>
          </div>
        )}
      />

      <div className="review-callout">
        <Sparkles size={19} />
        <div>
          <strong>Visual draft</strong>
          <p>Rows below are representative review data. No attendance, overtime, approval or payroll record has been created.</p>
        </div>
      </div>

      {supportMode ? (
        <div className={styles.supportNotice}>
          <Clock3 size={18} />
          <div>
            <strong>Founder support · Read only</strong>
            <span>Timesheet actions remain blocked during the audited support session.</span>
          </div>
        </div>
      ) : null}

      <div className="stat-grid">
        <StatCard label="Scheduled" value={`${totalScheduled.toFixed(1)}h`} detail="Preview rota total" icon={<CalendarDays size={19} />} />
        <StatCard label="Recorded" value={`${totalRecorded.toFixed(1)}h`} detail="Preview attendance total" icon={<Clock3 size={19} />} />
        <StatCard label="Pending approval" value={String(pendingCount)} detail="Manager review required" icon={<UserRoundCheck size={19} />} />
        <StatCard label="Exceptions" value={String(exceptionCount)} detail="Missing or mismatched time" icon={<AlertCircle size={19} />} />
      </div>

      <Card className={styles.moduleCard}>
        <div className={styles.toolbar}>
          <label className={styles.searchField}>
            <Search size={17} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search employee, role, period or source…"
              aria-label="Search timesheets"
            />
          </label>
          <div className={styles.filters} aria-label="Timesheet filters">
            {(["all", "pending", "approved", "exception"] as TimesheetFilter[]).map((item) => (
              <button
                key={item}
                type="button"
                className={filter === item ? styles.activeFilter : ""}
                onClick={() => setFilter(item)}
              >
                {item === "all" ? "All" : item === "pending" ? "Pending" : item === "approved" ? "Approved" : "Exceptions"}
              </button>
            ))}
          </div>
          <Badge tone="neutral">{visibleRows.length} preview rows</Badge>
        </div>

        <div className="table-scroll">
          <table className={styles.dataTable}>
            <thead>
              <tr>
                <th>Team member</th>
                <th>Period</th>
                <th>Scheduled</th>
                <th>Recorded</th>
                <th>Variance</th>
                <th>Overtime</th>
                <th>Source</th>
                <th>Status</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => {
                const variance = row.recordedHours - row.scheduledHours;
                return (
                  <tr key={`${row.employee}-${row.period}`}>
                    <td>
                      <div className={styles.identityCell}>
                        <span className={styles.identityIcon}><UserRoundCheck size={17} /></span>
                        <div><strong>{row.employee}</strong><small>{row.role}</small></div>
                      </div>
                    </td>
                    <td>{row.period}</td>
                    <td><span className={styles.hoursCell}><CalendarDays size={14} /> {row.scheduledHours.toFixed(1)}h</span></td>
                    <td><span className={styles.hoursCell}><Clock3 size={14} /> {row.recordedHours.toFixed(1)}h</span></td>
                    <td>{variance > 0 ? "+" : ""}{variance.toFixed(1)}h</td>
                    <td>{row.overtimeHours.toFixed(1)}h</td>
                    <td><span className={styles.secondaryText}>{row.source}</span></td>
                    <td><Badge tone={toneByStatus[row.status]}>{row.status}</Badge></td>
                    <td><Button type="button" variant="quiet" disabled>Review</Button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {visibleRows.length === 0 ? (
          <div className={styles.emptyState}>
            <Clock3 size={23} />
            <h3>No preview timesheets match</h3>
            <p>Change the search term or approval filter.</p>
          </div>
        ) : null}
      </Card>

      <div className={styles.lowerGrid}>
        <Card className={styles.guidanceCard}>
          <div className={styles.cardIcon}><CalendarCheck2 size={20} /></div>
          <p className="eyebrow">Calendar boundary</p>
          <h2>Scheduled time is not recorded attendance</h2>
          <p className="muted">Appointments, meetings and rota hours may suggest expected time. Timesheets must preserve the actual clock or manual entries used for approval.</p>
        </Card>
        <Card className={styles.guidanceCard}>
          <div className={styles.cardIcon}><UserRoundCheck size={20} /></div>
          <p className="eyebrow">Workforce boundary</p>
          <h2>Approval here, payroll elsewhere</h2>
          <p className="muted">Timesheets can calculate approved hours and exceptions. Payroll rates, payslips, tax and settlement should remain a separate workforce or payroll capability.</p>
        </Card>
      </div>

      <Dialog
        open={entryOpen}
        onClose={() => setEntryOpen(false)}
        title="Add time entry"
        description="Visual preview only. The entry will not be recorded or submitted for approval."
        className={styles.draftDialog}
      >
        <div className={styles.formBody}>
          <div className={styles.formGrid}>
            <label>Team member<select disabled defaultValue="owner"><option value="owner">Vanita Workspace Owner</option></select></label>
            <label>Date<input disabled type="date" defaultValue="2026-07-27" /></label>
            <label>Start time<input disabled type="time" defaultValue="09:00" /></label>
            <label>End time<input disabled type="time" defaultValue="17:30" /></label>
            <label>Unpaid break (minutes)<input disabled type="number" placeholder="30" /></label>
            <label>Entry source<select disabled defaultValue="manual"><option value="manual">Manual adjustment</option><option value="clock">Clock entry</option><option value="calendar">Calendar-derived draft</option></select></label>
            <label>Linked appointment or meeting<input disabled placeholder="Optional calendar record" /></label>
            <label>Approval status<select disabled defaultValue="pending"><option value="pending">Pending approval</option><option value="approved">Approved</option><option value="exception">Exception</option></select></label>
            <label className={styles.full}>Reason or notes<textarea disabled rows={3} placeholder="Reason for manual entry or adjustment" /></label>
          </div>
          <div className={styles.boundaryNote}>
            <AlertCircle size={18} />
            <div>
              <strong>Attendance must remain auditable</strong>
              <span>Manual changes will eventually require an actor, reason, original values and approval history. Calendar events alone cannot prove attendance.</span>
            </div>
          </div>
        </div>
        <div className="dialog-actions">
          <Button type="button" variant="quiet" onClick={() => setEntryOpen(false)}>Close preview</Button>
          <Button type="button" disabled>Save time entry</Button>
        </div>
      </Dialog>
    </>
  );
}
