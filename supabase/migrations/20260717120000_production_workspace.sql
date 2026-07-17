do $$
declare
  v_plan_id uuid;
  v_workspace_id uuid;
begin
  select id
    into v_plan_id
  from public.plans
  where code = 'pro'
    and is_active = true
  limit 1;

  if v_plan_id is null then
    raise exception 'The active Pro plan is required before creating the production workspace.';
  end if;

  insert into public.workspaces (slug, name, status, plan_id)
  values ('bdb-os', 'BDB OS', 'active', v_plan_id)
  on conflict (slug) do update
    set name = excluded.name,
        status = excluded.status,
        plan_id = excluded.plan_id,
        updated_at = now()
  returning id into v_workspace_id;

  insert into public.workspace_settings (
    workspace_id,
    owner_name,
    currency,
    invoice_prefix,
    vat_rate,
    timezone
  )
  values (
    v_workspace_id,
    'Founders',
    'EUR',
    'BDB',
    18,
    'Europe/Malta'
  )
  on conflict (workspace_id) do update
    set owner_name = excluded.owner_name,
        currency = excluded.currency,
        invoice_prefix = excluded.invoice_prefix,
        vat_rate = excluded.vat_rate,
        timezone = excluded.timezone,
        updated_at = now();

  insert into public.workspace_themes (
    workspace_id,
    preset,
    mode,
    accent_color,
    font_family,
    text_scale,
    density,
    high_contrast,
    reduced_motion
  )
  values (
    v_workspace_id,
    'obsidian-gold',
    'dark',
    '#d3a84b',
    'manrope',
    1,
    'comfortable',
    false,
    false
  )
  on conflict (workspace_id) do update
    set preset = excluded.preset,
        mode = excluded.mode,
        accent_color = excluded.accent_color,
        font_family = excluded.font_family,
        text_scale = excluded.text_scale,
        density = excluded.density,
        high_contrast = excluded.high_contrast,
        reduced_motion = excluded.reduced_motion,
        updated_at = now();
end
$$;
