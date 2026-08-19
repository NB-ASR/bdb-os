begin;

-- Issued business documents preserve the branding that existed at issue time.
-- Current workspace branding may change later without rewriting historical paperwork.

alter table public.invoices
  add column if not exists supplier_logo_path_snapshot text,
  add column if not exists branding_snapshot_at timestamptz;

alter table public.credit_notes
  add column if not exists supplier_logo_path_snapshot text,
  add column if not exists branding_snapshot_at timestamptz;

alter table public.delivery_notes
  add column if not exists supplier_logo_path_snapshot text,
  add column if not exists branding_snapshot_at timestamptz;

alter table public.invoices
  drop constraint if exists invoices_supplier_logo_path_snapshot_length,
  add constraint invoices_supplier_logo_path_snapshot_length
    check (supplier_logo_path_snapshot is null or char_length(supplier_logo_path_snapshot) <= 1000);
alter table public.credit_notes
  drop constraint if exists credit_notes_supplier_logo_path_snapshot_length,
  add constraint credit_notes_supplier_logo_path_snapshot_length
    check (supplier_logo_path_snapshot is null or char_length(supplier_logo_path_snapshot) <= 1000);
alter table public.delivery_notes
  drop constraint if exists delivery_notes_supplier_logo_path_snapshot_length,
  add constraint delivery_notes_supplier_logo_path_snapshot_length
    check (supplier_logo_path_snapshot is null or char_length(supplier_logo_path_snapshot) <= 1000);

create or replace function private.current_custom_branding_logo_path(p_workspace_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when coalesce(
      (
        select override.enabled
        from public.workspace_feature_overrides override
        where override.workspace_id = p_workspace_id
          and override.feature_key = 'custom_branding'
          and (override.starts_at is null or override.starts_at <= now())
          and (override.ends_at is null or override.ends_at > now())
        limit 1
      ),
      (
        select plan_feature.enabled
        from public.workspaces workspace
        join public.plan_features plan_feature
          on plan_feature.plan_id = workspace.plan_id
         and plan_feature.feature_key = 'custom_branding'
        where workspace.id = p_workspace_id
        limit 1
      ),
      false
    ) then theme.client_logo_path
    else null
  end
  from public.workspace_themes theme
  where theme.workspace_id = p_workspace_id;
$$;

revoke all on function private.current_custom_branding_logo_path(uuid) from public, anon, authenticated;
grant execute on function private.current_custom_branding_logo_path(uuid) to service_role;

create or replace function private.snapshot_business_document_branding()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  should_capture boolean := false;
begin
  if tg_op = 'INSERT' then
    should_capture := new.status::text <> 'draft';
  elsif old.status::text = 'draft' and new.status::text <> 'draft' then
    should_capture := true;
  end if;

  if should_capture then
    new.supplier_logo_path_snapshot := private.current_custom_branding_logo_path(new.workspace_id);
    new.branding_snapshot_at := now();
  elsif tg_op = 'UPDATE' and old.branding_snapshot_at is not null then
    -- Once captured, later accounting/status changes cannot rewrite issued branding.
    new.supplier_logo_path_snapshot := old.supplier_logo_path_snapshot;
    new.branding_snapshot_at := old.branding_snapshot_at;
  end if;

  return new;
end;
$$;

revoke all on function private.snapshot_business_document_branding() from public, anon, authenticated;

-- Historical reconstruction is intentionally audit-backed. Custom Business Branding launched
-- disabled-by-default and Founder Admin records both logo changes and feature overrides.
create or replace function private.historical_custom_branding_logo_path(
  p_workspace_id uuid,
  p_at timestamptz
)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  feature_enabled boolean := false;
  logo_action text;
  logo_path text;
begin
  select coalesce((audit.metadata->>'enabled')::boolean, false)
  into feature_enabled
  from public.audit_logs audit
  where audit.workspace_id = p_workspace_id
    and audit.action = 'admin.feature-override'
    and audit.metadata->>'featureKey' = 'custom_branding'
    and audit.created_at <= p_at
  order by audit.created_at desc
  limit 1;

  if not coalesce(feature_enabled, false) then
    return null;
  end if;

  select audit.action,
         case when audit.action = 'admin.custom_branding.logo_updated'
              then nullif(audit.metadata->>'logo_path', '')
              else null end
  into logo_action, logo_path
  from public.audit_logs audit
  where audit.workspace_id = p_workspace_id
    and audit.action in ('admin.custom_branding.logo_updated', 'admin.custom_branding.logo_removed')
    and audit.created_at <= p_at
  order by audit.created_at desc
  limit 1;

  if logo_action = 'admin.custom_branding.logo_updated' then
    return logo_path;
  end if;
  return null;
end;
$$;

revoke all on function private.historical_custom_branding_logo_path(uuid,timestamptz) from public, anon, authenticated;

-- Backfill existing issued documents without allowing the normal touch/immutability triggers
-- to mutate their historical timestamps or block this one-time reconstruction.
alter table public.invoices disable trigger invoices_touch_updated_at;
update public.invoices invoice
set supplier_logo_path_snapshot = private.historical_custom_branding_logo_path(
      invoice.workspace_id,
      coalesce(invoice.final_number_assigned_at, invoice.legal_snapshot_at, invoice.created_at)
    ),
    branding_snapshot_at = coalesce(invoice.final_number_assigned_at, invoice.legal_snapshot_at, invoice.created_at)
where invoice.status::text <> 'draft'
  and invoice.branding_snapshot_at is null;
alter table public.invoices enable trigger invoices_touch_updated_at;

alter table public.credit_notes disable trigger credit_notes_immutability;
alter table public.credit_notes disable trigger credit_notes_touch_updated_at;
update public.credit_notes note
set supplier_logo_path_snapshot = private.historical_custom_branding_logo_path(
      note.workspace_id,
      coalesce(note.issued_at_timestamp, note.created_at)
    ),
    branding_snapshot_at = coalesce(note.issued_at_timestamp, note.created_at)
where note.status = 'issued'
  and note.branding_snapshot_at is null;
alter table public.credit_notes enable trigger credit_notes_touch_updated_at;
alter table public.credit_notes enable trigger credit_notes_immutability;

alter table public.delivery_notes disable trigger delivery_notes_immutability;
alter table public.delivery_notes disable trigger delivery_notes_touch_updated_at;
update public.delivery_notes note
set supplier_logo_path_snapshot = private.historical_custom_branding_logo_path(
      note.workspace_id,
      coalesce(note.issued_at, note.created_at)
    ),
    branding_snapshot_at = coalesce(note.issued_at, note.created_at)
where note.status = 'issued'
  and note.branding_snapshot_at is null;
alter table public.delivery_notes enable trigger delivery_notes_touch_updated_at;
alter table public.delivery_notes enable trigger delivery_notes_immutability;

drop function private.historical_custom_branding_logo_path(uuid,timestamptz);

drop trigger if exists invoices_snapshot_branding on public.invoices;
create trigger invoices_snapshot_branding
before insert or update on public.invoices
for each row execute function private.snapshot_business_document_branding();

drop trigger if exists credit_notes_snapshot_branding on public.credit_notes;
create trigger credit_notes_snapshot_branding
before insert or update on public.credit_notes
for each row execute function private.snapshot_business_document_branding();

drop trigger if exists delivery_notes_snapshot_branding on public.delivery_notes;
create trigger delivery_notes_snapshot_branding
before insert or update on public.delivery_notes
for each row execute function private.snapshot_business_document_branding();

commit;
