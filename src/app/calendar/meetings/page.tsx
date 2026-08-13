"use client";

import { useMemo, useState } from "react";
import {
  Building2,
  CalendarDays,
  Clock3,
  FileText,
  MessageSquareText,
  Plus,
  Search,
  Sparkles,
  UsersRound,
} from "lucide-react";
import { Badge, Button, Card, Dialog, PageHeader, StatCard } from "@/components/ui";
import styles from "../department.module.css";

type MeetingFilter = "all" | "internal" | "client" | "draft";

type PreviewMeeting = {
  title: string;
  date: string;
  time: string;
  durationMinutes: number;
  meetingType: "Internal" | "Client" | "Supplier";
  owner: string;
  attendees: number;
  location: string;
  linkedRecord: string;
  status: "Scheduled" | "Minutes draft" | "Completed";
};

const previewMeetings: PreviewMeeting[] = [
  {
    title: "Weekly operations review",
    date: "Next Monday",
    time: "09:00",
    durationMinutes: 45,
    meetingType: "Internal",
    owner: "Workspace Owner",
    attendees: 4,
    location: "Meeting room A",
    linkedRecord: "Sample operations review",
    status: "Scheduled",
  },
  {
    title: "Client treatment-plan consultation",
    date: "Next Monday",
    time: "13:30",
    durationMinutes: 30,
    meetingType: "Client",
    owner: "Team Member A",
    attendees: 2,
    location: "Meeting room B",
    linkedRecord: "Sample customer record",
    status: "Scheduled",
  },
  {
    title: "Supplier range and pricing review",
    date: "Next Tuesday",
    time: "11:00",
    durationMinutes: 60,
    meetingType: "Supplier",
    owner: "Workspace Owner",
    attendees: 3,
    location: "Online meeting",
    linkedRecord: "Sample supplier record",
    status: "Minutes draft",
  },
  {
    title: "Team retrospective",
    date: "Previous Friday",
    time: "17:00",
    durationMinutes: 45,
    meetingType: "Internal",
    owner: "Team Member B",
    attendees: 5,
    location: "Staff area",
    linkedRecord: "Sample minutes document",
    status: "Completed",
  },
];

const toneByType = {
  Internal: "blue",
  Client: "gold",
  Supplier: "neutral",
} as const;

const toneByStatus = {
  Scheduled: "green",
  "Minutes draft": "gold",
  Completed: "neutral",
} as const;

export default function MeetingsPage() {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<MeetingFilter>("all");
  const [meetingOpen, setMeetingOpen] = useState(false);

  const visibleMeetings = useMemo(() => {
    const term = query.trim().toLowerCase();
    return previewMeetings.filter((meeting) => {
      const matchesQuery = !term || [
        meeting.title,
        meeting.meetingType,
        meeting.owner,
        meeting.location,
        meeting.linkedRecord,
        meeting.status,
      ].join(" ").toLowerCase().includes(term);
      const matchesFilter = filter === "all"
        || (filter === "internal" && meeting.meetingType === "Internal")
        || (filter === "client" && meeting.meetingType === "Client")
        || (filter === "draft" && meeting.status === "Minutes draft");
      return matchesQuery && matchesFilter;
    });
  }, [filter, query]);

  const upcomingCount = previewMeetings.filter((meeting) => meeting.status === "Scheduled").length;
  const clientCount = previewMeetings.filter((meeting) => meeting.meetingType === "Client").length;
  const attendeeCount = previewMeetings.reduce((total, meeting) => total + meeting.attendees, 0);
  const minutesDraftCount = previewMeetings.filter((meeting) => meeting.status === "Minutes draft").length;

  return (
    <>
      <PageHeader
        eyebrow="Calendar department · Coordination draft"
        title="Meetings"
        description="Coordinate internal, customer and supplier meetings while keeping messages, minutes and linked business records in their owning departments."
        action={(
          <div className={styles.headerActions}>
            <Button variant="secondary" disabled title="Meeting templates will be connected after the meeting schema is approved">
              Meeting templates
            </Button>
            <Button onClick={() => setMeetingOpen(true)}>
              <Plus size={17} /> New meeting
            </Button>
          </div>
        )}
      />

      <div className="review-callout">
        <Sparkles size={19} />
        <div>
          <strong>Visual draft</strong>
          <p>Meetings below are representative review data. No invitation, room booking, notification or minutes document has been created.</p>
        </div>
      </div>

      <div className="stat-grid">
        <StatCard label="Upcoming" value={String(upcomingCount)} detail="Scheduled preview meetings" icon={<CalendarDays size={19} />} />
        <StatCard label="Client meetings" value={String(clientCount)} detail="Customer-linked coordination" icon={<Building2 size={19} />} />
        <StatCard label="Attendee links" value={String(attendeeCount)} detail="Preview participation total" icon={<UsersRound size={19} />} />
        <StatCard label="Minutes drafts" value={String(minutesDraftCount)} detail="Documents awaiting review" icon={<FileText size={19} />} />
      </div>

      <Card className={styles.moduleCard}>
        <div className={styles.toolbar}>
          <label className={styles.searchField}>
            <Search size={17} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search meeting, owner, location or linked record…"
              aria-label="Search meetings"
            />
          </label>
          <div className={styles.filters} aria-label="Meeting filters">
            {(["all", "internal", "client", "draft"] as MeetingFilter[]).map((item) => (
              <button
                key={item}
                type="button"
                className={filter === item ? styles.activeFilter : ""}
                onClick={() => setFilter(item)}
              >
                {item === "all" ? "All" : item === "internal" ? "Internal" : item === "client" ? "Client" : "Minutes draft"}
              </button>
            ))}
          </div>
          <Badge tone="neutral">{visibleMeetings.length} preview meetings</Badge>
        </div>

        <div className={styles.meetingGrid}>
          {visibleMeetings.map((meeting) => (
            <article className={styles.meetingCard} key={`${meeting.title}-${meeting.date}`}>
              <div className={styles.meetingCardHeader}>
                <div>
                  <Badge tone={toneByType[meeting.meetingType]}>{meeting.meetingType}</Badge>
                  <h3>{meeting.title}</h3>
                </div>
                <Badge tone={toneByStatus[meeting.status]}>{meeting.status}</Badge>
              </div>
              <div className={styles.meetingMeta}>
                <span><CalendarDays size={14} /> {meeting.date}</span>
                <span><Clock3 size={14} /> {meeting.time} · {meeting.durationMinutes} min</span>
                <span><UsersRound size={14} /> {meeting.attendees} attendees</span>
                <span><Building2 size={14} /> {meeting.location}</span>
              </div>
              <div className={styles.meetingFooter}>
                <div>
                  <strong>{meeting.owner}</strong>
                  <div className={styles.linkCell}><MessageSquareText size={14} /><span className={styles.secondaryText}>{meeting.linkedRecord}</span></div>
                </div>
                <Button type="button" variant="quiet" disabled>Open</Button>
              </div>
            </article>
          ))}
        </div>

        {visibleMeetings.length === 0 ? (
          <div className={styles.emptyState}>
            <UsersRound size={23} />
            <h3>No preview meetings match</h3>
            <p>Change the search term or meeting filter.</p>
          </div>
        ) : null}
      </Card>

      <div className={styles.lowerGrid}>
        <Card className={styles.guidanceCard}>
          <div className={styles.cardIcon}><MessageSquareText size={20} /></div>
          <p className="eyebrow">Communications boundary</p>
          <h2>Calendar schedules the meeting</h2>
          <p className="muted">Invitations and reminders can be triggered from the meeting, but sent messages and replies remain in Communications and the linked customer or supplier history.</p>
        </Card>
        <Card className={styles.guidanceCard}>
          <div className={styles.cardIcon}><FileText size={20} /></div>
          <p className="eyebrow">Documents boundary</p>
          <h2>Minutes remain a document</h2>
          <p className="muted">The meeting may create or link minutes, decisions and attachments. Their content, versions and retention remain owned by Documents.</p>
        </Card>
      </div>

      <Dialog
        open={meetingOpen}
        onClose={() => setMeetingOpen(false)}
        title="New meeting"
        description="Visual preview only. No attendees will be invited and no calendar record will be saved."
        className={styles.draftDialog}
      >
        <div className={styles.formBody}>
          <div className={styles.formGrid}>
            <label className={styles.full}>Meeting title<input disabled placeholder="e.g. Supplier range and pricing review" /></label>
            <label>Meeting type<select disabled defaultValue="internal"><option value="internal">Internal</option><option value="client">Client</option><option value="supplier">Supplier</option></select></label>
            <label>Owner<select disabled defaultValue="owner"><option value="owner">Workspace Owner</option></select></label>
            <label>Date<input disabled type="date" /></label>
            <label>Start time<input disabled type="time" defaultValue="11:00" /></label>
            <label>Duration<select disabled defaultValue="60"><option value="30">30 minutes</option><option value="45">45 minutes</option><option value="60">60 minutes</option><option value="90">90 minutes</option></select></label>
            <label>Room or link<input disabled placeholder="Room, address or online URL" /></label>
            <label className={styles.full}>Attendees<input disabled placeholder="Team members, customer contacts or supplier contacts" /></label>
            <label>Linked business record<select disabled defaultValue="none"><option value="none">None</option><option value="customer">Customer</option><option value="supplier">Supplier</option><option value="project">Project or internal record</option></select></label>
            <label>Minutes option<select disabled defaultValue="draft"><option value="draft">Create minutes draft after meeting</option><option value="none">No minutes document</option></select></label>
            <label className={styles.full}>Agenda<textarea disabled rows={4} placeholder="Meeting objectives and discussion items" /></label>
          </div>
          <div className={styles.boundaryNote}>
            <MessageSquareText size={18} />
            <div>
              <strong>One meeting, connected records</strong>
              <span>The approved record will schedule time and attendees. Invitations belong to Communications, minutes belong to Documents, and customer or supplier context remains on the linked business record.</span>
            </div>
          </div>
        </div>
        <div className="dialog-actions">
          <Button type="button" variant="quiet" onClick={() => setMeetingOpen(false)}>Close preview</Button>
          <Button type="button" disabled>Create meeting</Button>
        </div>
      </Dialog>
    </>
  );
}
