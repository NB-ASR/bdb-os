begin;

create table if not exists public.sector_packs (
  id uuid primary key default gen_random_uuid(),
  key text not null,
  version integer not null default 1 check (version > 0),
  name text not null,
  sector text not null,
  description text not null default '',
  config jsonb not null default '{}'::jsonb check (jsonb_typeof(config) = 'object'),
  is_active boolean not null default true,
  created_by uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (key, version)
);

create table if not exists public.workspace_sector_configs (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  sector_pack_id uuid not null references public.sector_packs(id) on delete restrict,
  draft_overrides jsonb not null default '{}'::jsonb check (jsonb_typeof(draft_overrides) = 'object'),
  published_config jsonb null check (published_config is null or jsonb_typeof(published_config) = 'object'),
  status text not null default 'draft' check (status in ('draft', 'published')),
  published_at timestamptz null,
  updated_by uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists workspace_sector_configs_pack_idx
  on public.workspace_sector_configs(sector_pack_id);

alter table public.sector_packs enable row level security;
alter table public.workspace_sector_configs enable row level security;

revoke all on public.sector_packs from anon, authenticated;
revoke all on public.workspace_sector_configs from anon, authenticated;
grant select on public.workspace_sector_configs to authenticated;

create policy "Workspace members can read published sector configuration"
  on public.workspace_sector_configs
  for select
  to authenticated
  using (
    status = 'published'
    and published_config is not null
    and exists (
      select 1
      from public.workspace_memberships membership
      where membership.workspace_id = workspace_sector_configs.workspace_id
        and membership.user_id = auth.uid()
        and membership.status = 'active'
    )
  );

insert into public.sector_packs (key, version, name, sector, description, config)
values
(
  'general-services',
  1,
  'General Services',
  'General',
  'Balanced operating workspace for service businesses without a specialist sector pack.',
  '{
    "key":"general-services","name":"General Services","sector":"General","version":1,
    "description":"Balanced operating workspace for service businesses without a specialist sector pack.",
    "labels":{"customerSingular":"Customer","customerPlural":"Customers","appointmentSingular":"Appointment","appointmentPlural":"Appointments","invoiceSingular":"Invoice","invoicePlural":"Invoices","documentSingular":"Document","documentPlural":"Documents","navigation":{}},
    "navigation":{"enabled":["overview","accounts","customers","calendar","communications","documents","banking","reports","automation"],"emphasis":["overview","customers","calendar","communications","accounts"]},
    "workflows":["appointment-reminders","new-enquiry-triage","overdue-invoice-follow-up","document-request-follow-up","client-onboarding"],
    "compliance":["document-retention"],
    "dashboard":["today","communications","appointments","outstanding-balances","documents"],
    "recordFields":{"customer":["contact-details","preferences","notes"],"appointment":["date-time","duration","status"],"invoice":["issue-date","due-date","amount","status"],"document":["type","linked-record","retention-status"]}
  }'::jsonb
),
(
  'healthcare-practice',
  1,
  'Healthcare Practice',
  'Healthcare',
  'Patient-centred configuration for independent clinics and allied healthcare practices.',
  '{
    "key":"healthcare-practice","name":"Healthcare Practice","sector":"Healthcare","version":1,
    "description":"Patient-centred configuration for independent clinics and allied healthcare practices.",
    "labels":{"customerSingular":"Patient","customerPlural":"Patients","appointmentSingular":"Consultation","appointmentPlural":"Consultations","invoiceSingular":"Invoice","invoicePlural":"Invoices","documentSingular":"Clinical document","documentPlural":"Clinical documents","navigation":{"customers":"Patients","calendar":"Consultations","communications":"Patient communications","documents":"Clinical documents"}},
    "navigation":{"enabled":["overview","accounts","customers","calendar","communications","documents","reports","automation"],"emphasis":["overview","customers","calendar","communications","documents"]},
    "workflows":["appointment-reminders","missed-appointment-follow-up","new-enquiry-triage","document-request-follow-up","client-onboarding"],
    "compliance":["consent-recording","confidential-notes","document-retention","identity-verification","professional-review"],
    "dashboard":["today","patient-arrivals","unconfirmed-consultations","communications","documents-requiring-review"],
    "recordFields":{"customer":["contact-details","date-of-birth","emergency-contact","consent-status","communication-preferences"],"appointment":["date-time","duration","practitioner","consultation-type","status"],"invoice":["issue-date","due-date","amount","payer","status"],"document":["document-type","patient-link","confidentiality","review-status","retention-status"]}
  }'::jsonb
),
(
  'wellness-studio',
  1,
  'Wellness Studio',
  'Wellness',
  'Booking-led configuration for beauty, wellbeing, therapy and personal care businesses.',
  '{
    "key":"wellness-studio","name":"Wellness Studio","sector":"Wellness","version":1,
    "description":"Booking-led configuration for beauty, wellbeing, therapy and personal care businesses.",
    "labels":{"customerSingular":"Client","customerPlural":"Clients","appointmentSingular":"Session","appointmentPlural":"Sessions","invoiceSingular":"Invoice","invoicePlural":"Invoices","documentSingular":"Client document","documentPlural":"Client documents","navigation":{"customers":"Clients","calendar":"Sessions","communications":"Client inbox"}},
    "navigation":{"enabled":["overview","accounts","customers","calendar","communications","documents","reports","automation"],"emphasis":["overview","calendar","customers","communications","accounts"]},
    "workflows":["appointment-reminders","missed-appointment-follow-up","new-enquiry-triage","overdue-invoice-follow-up","client-onboarding"],
    "compliance":["consent-recording","confidential-notes","document-retention"],
    "dashboard":["today","sessions","late-cancellations","rebooking-opportunities","outstanding-balances"],
    "recordFields":{"customer":["contact-details","preferences","contraindications","consent-status","notes"],"appointment":["date-time","duration","service","practitioner","status"],"invoice":["issue-date","due-date","amount","payment-method","status"],"document":["type","client-link","consent-status","retention-status"]}
  }'::jsonb
),
(
  'legal-practice',
  1,
  'Legal Practice',
  'Legal',
  'Matter-centred configuration for legal clinics, solicitors and advisory practices.',
  '{
    "key":"legal-practice","name":"Legal Practice","sector":"Legal","version":1,
    "description":"Matter-centred configuration for legal clinics, solicitors and advisory practices.",
    "labels":{"customerSingular":"Client","customerPlural":"Clients","appointmentSingular":"Meeting","appointmentPlural":"Meetings","invoiceSingular":"Fee note","invoicePlural":"Fee notes","documentSingular":"Matter document","documentPlural":"Matter documents","navigation":{"accounts":"Fees","customers":"Clients & matters","calendar":"Meetings & deadlines","communications":"Matter communications","documents":"Matter documents"}},
    "navigation":{"enabled":["overview","accounts","customers","calendar","communications","documents","reports","automation"],"emphasis":["overview","customers","documents","calendar","communications"]},
    "workflows":["new-enquiry-triage","client-onboarding","matter-deadline-review","document-request-follow-up","overdue-invoice-follow-up"],
    "compliance":["confidential-notes","document-retention","conflict-check","engagement-letter","identity-verification","professional-review"],
    "dashboard":["today","matter-deadlines","conflict-checks","documents-requiring-review","outstanding-fees"],
    "recordFields":{"customer":["contact-details","matter-reference","conflict-check-status","identity-status","engagement-status"],"appointment":["date-time","duration","matter-reference","meeting-type","status"],"invoice":["issue-date","due-date","amount","matter-reference","status"],"document":["document-type","matter-reference","confidentiality","review-status","retention-status"]}
  }'::jsonb
),
(
  'accounting-firm',
  1,
  'Accounting Firm',
  'Accounting',
  'Deadline and document-led configuration for accountants, bookkeepers and tax advisers.',
  '{
    "key":"accounting-firm","name":"Accounting Firm","sector":"Accounting","version":1,
    "description":"Deadline and document-led configuration for accountants, bookkeepers and tax advisers.",
    "labels":{"customerSingular":"Client","customerPlural":"Clients","appointmentSingular":"Review","appointmentPlural":"Reviews","invoiceSingular":"Invoice","invoicePlural":"Invoices","documentSingular":"Financial document","documentPlural":"Financial documents","navigation":{"customers":"Clients","calendar":"Deadlines & reviews","communications":"Client requests","documents":"Financial documents","reports":"Practice reports"}},
    "navigation":{"enabled":["overview","accounts","customers","calendar","communications","documents","banking","reports","automation"],"emphasis":["overview","documents","calendar","customers","accounts"]},
    "workflows":["client-onboarding","document-request-follow-up","overdue-invoice-follow-up","recurring-compliance-check","new-enquiry-triage"],
    "compliance":["document-retention","engagement-letter","identity-verification","professional-review"],
    "dashboard":["today","filing-deadlines","missing-client-records","documents-requiring-review","outstanding-balances"],
    "recordFields":{"customer":["contact-details","entity-type","financial-year-end","tax-reference","engagement-status"],"appointment":["date-time","duration","review-type","period","status"],"invoice":["issue-date","due-date","amount","service-period","status"],"document":["document-type","client-link","financial-period","review-status","retention-status"]}
  }'::jsonb
)
on conflict (key, version) do update
set name = excluded.name,
    sector = excluded.sector,
    description = excluded.description,
    config = excluded.config,
    is_active = true,
    updated_at = now();

commit;
