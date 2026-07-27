"use client";

import { useMemo, useState } from "react";
import {
  Archive,
  CalendarDays,
  CircleDollarSign,
  Clock3,
  Plus,
  ReceiptText,
  Search,
  Sparkles,
  UsersRound,
  Wrench,
} from "lucide-react";
import { useBdb } from "@/lib/store";
import { Badge, Button, Card, Dialog, PageHeader, StatCard } from "@/components/ui";
import styles from "./services.module.css";

type ServiceFilter = "all" | "bookable" | "internal" | "archived";

type PreviewService = {
  name: string;
  code: string;
  category: string;
  durationMinutes: number;
  price: number | null;
  vatRate: number;
  eligibleStaff: number;
  bookingMode: "Customer bookable" | "Staff only";
  status: "Active" | "Archived";
};

const previewServices: PreviewService[] = [
  {
    name: "Deep Cleansing Facial",
    code: "FAC-DEEP-60",
    category: "Facials",
    durationMinutes: 60,
    price: 65,
    vatRate: 18,
    eligibleStaff: 2,
    bookingMode: "Customer bookable",
    status: "Active",
  },
  {
    name: "Hydrating Facial Treatment",
    code: "FAC-HYD-75",
    category: "Facials",
    durationMinutes: 75,
    price: 82,
    vatRate: 18,
    eligibleStaff: 2,
    bookingMode: "Customer bookable",
    status: "Active",
  },
  {
    name: "Consultation and Skin Review",
    code: "CONSULT-30",
    category: "Consultations",
    durationMinutes: 30,
    price: null,
    vatRate: 0,
    eligibleStaff: 1,
    bookingMode: "Staff only",
    status: "Active",
  },
  {
    name: "Seasonal Body Treatment",
    code: "BODY-SEASON",
    category: "Body treatments",
    durationMinutes: 90,
    price: 95,
    vatRate: 18,
    eligibleStaff: 1,
    bookingMode: "Customer bookable",
    status: "Archived",
  },
];

export default function ServicesPage() {
  const { state, role } = useBdb();
  const [formOpen, setFormOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ServiceFilter>("all");
  const supportMode = role === "platform-support";

  const currency = useMemo(
    () => new Intl.NumberFormat("en-GB", { style: "currency", currency: state.settings.currency }),
    [state.settings.currency],
  );

  const visibleServices = useMemo(() => {
    const term = query.trim().toLowerCase();
    return previewServices.filter((service) => {
      const matchesQuery = !term || [
        service.name,
        service.code,
        service.category,
        service.bookingMode,
      ].join(" ").toLowerCase().includes(term);
      const matchesFilter = filter === "all"
        || (filter === "bookable" && service.bookingMode === "Customer bookable" && service.status === "Active")
        || (filter === "internal" && service.bookingMode === "Staff only" && service.status === "Active")
        || (filter === "archived" && service.status === "Archived");
      return matchesQuery && matchesFilter;
    });
  }, [filter, query]);

  const bookableCount = previewServices.filter((service) => service.bookingMode === "Customer bookable" && service.status === "Active").length;
  const activeStaffLinks = previewServices
    .filter((service) => service.status === "Active")
    .reduce((total, service) => total + service.eligibleStaff, 0);

  return (
    <>
      <PageHeader
        eyebrow="Service catalogue"
        title="Services"
        description="Define bookable work that Calendar, customer history and invoice lines will reference across the workspace."
        action={(
          <div className={styles.headerActions}>
            <Button variant="secondary" disabled title="Bulk service import will be connected after the service schema is approved">
              <Wrench size={17} /> Import services
            </Button>
            <Button onClick={() => setFormOpen(true)}>
              <Plus size={17} /> Add service
            </Button>
          </div>
        )}
      />

      <div className="review-callout">
        <Sparkles size={19} />
        <div>
          <strong>Visual migration preview</strong>
          <p>Rows below are representative design data only. No service, price, staff eligibility or appointment rule has been created.</p>
        </div>
      </div>

      {supportMode ? (
        <div className={styles.supportNotice}>
          <Wrench size={18} />
          <div><strong>Founder support · Read only</strong><span>Service catalogue changes remain blocked during the audited support session.</span></div>
        </div>
      ) : null}

      <div className="stat-grid">
        <StatCard label="Preview services" value={String(previewServices.length)} detail="Representative catalogue rows" icon={<Wrench size={19} />} />
        <StatCard label="Customer bookable" value={String(bookableCount)} detail="Visible appointment options" icon={<CalendarDays size={19} />} />
        <StatCard label="Staff eligibility links" value={String(activeStaffLinks)} detail="Preview staff-to-service links" icon={<UsersRound size={19} />} />
        <StatCard label="Invoice-ready" value={String(previewServices.filter((service) => service.price !== null && service.status === "Active").length)} detail="Priced active services" icon={<ReceiptText size={19} />} />
      </div>

      <Card className={styles.servicesCard}>
        <div className={styles.toolbar}>
          <label className={styles.searchField}>
            <Search size={17} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search service, code, category or booking mode…"
              aria-label="Search services"
            />
          </label>
          <div className={styles.filters} aria-label="Service filters">
            {(["all", "bookable", "internal", "archived"] as ServiceFilter[]).map((item) => (
              <button
                key={item}
                type="button"
                className={filter === item ? styles.activeFilter : ""}
                onClick={() => setFilter(item)}
              >
                {item === "all" ? "All" : item === "bookable" ? "Bookable" : item === "internal" ? "Staff only" : "Archived"}
              </button>
            ))}
          </div>
          <Badge tone="neutral">{visibleServices.length} preview rows</Badge>
        </div>

        <div className="table-scroll">
          <table className={styles.serviceTable}>
            <thead>
              <tr>
                <th>Service</th>
                <th>Code</th>
                <th>Category</th>
                <th>Duration</th>
                <th>Price</th>
                <th>VAT</th>
                <th>Eligible staff</th>
                <th>Booking</th>
                <th>Status</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {visibleServices.map((service) => (
                <tr key={service.code}>
                  <td>
                    <div className={styles.serviceIdentity}>
                      <span><Wrench size={17} /></span>
                      <div><strong>{service.name}</strong><small>Reusable service definition</small></div>
                    </div>
                  </td>
                  <td><code>{service.code}</code></td>
                  <td>{service.category}</td>
                  <td><div className={styles.durationCell}><Clock3 size={15} /><span>{service.durationMinutes} min</span></div></td>
                  <td>{service.price === null ? <span className="muted">No charge</span> : currency.format(service.price)}</td>
                  <td>{service.vatRate}%</td>
                  <td><div className={styles.staffCell}><UsersRound size={15} /><span>{service.eligibleStaff}</span></div></td>
                  <td><Badge tone={service.bookingMode === "Customer bookable" ? "gold" : "blue"}>{service.bookingMode}</Badge></td>
                  <td><Badge tone={service.status === "Active" ? "green" : "neutral"}>{service.status}</Badge></td>
                  <td><Button type="button" variant="quiet" disabled aria-label={`Edit ${service.name}`}>Edit</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {visibleServices.length === 0 ? (
          <div className={styles.emptyState}>
            <Wrench size={23} />
            <h3>No preview services match</h3>
            <p>Change the search term or service filter.</p>
          </div>
        ) : null}
      </Card>

      <div className={styles.lowerGrid}>
        <Card className={styles.guidanceCard}>
          <div className={styles.cardIcon}><CalendarDays size={20} /></div>
          <p className="eyebrow">Calendar boundary</p>
          <h2>Definition here, availability in Calendar</h2>
          <p className="muted">Duration, buffers and eligible staff belong to the service definition. Working hours, leave and appointment availability remain Calendar responsibilities.</p>
        </Card>
        <Card className={styles.guidanceCard}>
          <div className={styles.cardIcon}><Archive size={20} /></div>
          <p className="eyebrow">Historical integrity</p>
          <h2>Archive services instead of deleting them</h2>
          <p className="muted">A service used by an appointment, customer history or invoice must remain available to historical records even after it is no longer offered.</p>
        </Card>
      </div>

      <Dialog
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title="Add service"
        description="Visual preview of the reusable BDB OS service definition. Fields do not accept or save data yet."
        className={styles.serviceDialog}
      >
        <div className={styles.formBody}>
          <div className={styles.formGrid}>
            <label className={styles.wide}>Service name<input disabled placeholder="e.g. Deep Cleansing Facial" /></label>
            <label>Service code<input disabled placeholder="e.g. FAC-DEEP-60" /></label>
            <label>Category<select disabled defaultValue="facials"><option value="facials">Facials</option><option value="consultations">Consultations</option><option value="body">Body treatments</option></select></label>
            <label>Duration (minutes)<input disabled type="number" placeholder="60" /></label>
            <label>Preparation buffer (minutes)<input disabled type="number" placeholder="10" /></label>
            <label>Recovery buffer (minutes)<input disabled type="number" placeholder="10" /></label>
            <label>Price ({state.settings.currency})<input disabled type="number" placeholder="0.00" /></label>
            <label>VAT rate (%)<input disabled type="number" placeholder="18" /></label>
            <label>Booking visibility<select disabled defaultValue="customer"><option value="customer">Customer bookable</option><option value="staff">Staff only</option></select></label>
            <label>Status<select disabled defaultValue="active"><option value="active">Active</option><option value="archived">Archived</option></select></label>
            <label className={styles.wide}>Eligible staff<div className={styles.staffPreview}><span>Vanita Workspace Owner</span><span>Senior therapist</span><span>Choose staff later</span></div></label>
            <label className={styles.wide}>Description<textarea disabled rows={3} placeholder="Customer-facing service description" /></label>
          </div>
          <div className={styles.calendarNote}>
            <CircleDollarSign size={18} />
            <div><strong>One service, connected workflows</strong><span>The approved record will feed appointment booking, staff eligibility, customer history and invoice lines without duplicating the service in each department.</span></div>
          </div>
        </div>
        <div className="dialog-actions">
          <Button type="button" variant="quiet" onClick={() => setFormOpen(false)}>Close preview</Button>
          <Button type="button" disabled>Save service</Button>
        </div>
      </Dialog>
    </>
  );
}
