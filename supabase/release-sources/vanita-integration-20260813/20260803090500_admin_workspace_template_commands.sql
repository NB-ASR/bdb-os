create or replace function public.save_workspace_template(
  target_actor_user_id uuid,
  target_template_id uuid,
  target_code text,
  target_name text,
  target_description text,
  target_plan_id uuid,
  target_is_active boolean,
  target_is_default boolean,
  target_settings_defaults jsonb,
  target_theme_defaults jsonb,
  target_features jsonb,
  target_permissions jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  resolved_template_id uuid;
  resolved_version integer;
  normalized_code text := lower(btrim(coalesce(target_code, '')));
  normalized_name text := btrim(coalesce(target_name, ''));
  normalized_settings jsonb := jsonb_build_object(
    'currency', 'GBP',
    'invoicePrefix', 'BDB',
    'vatRate', 20,
    'timezone', 'Europe/London'
  ) || coalesce(target_settings_defaults, '{}'::jsonb);
  normalized_theme jsonb := jsonb_build_object(
    'preset', 'obsidian-gold',
    'mode', 'dark',
    'accentColor', '#d3a84b',
    'fontFamily', 'manrope',
    'textScale', 1,
    'density', 'comfortable',
    'highContrast', false,
    'reducedMotion', false
  ) || coalesce(target_theme_defaults, '{}'::jsonb);
  active_feature_count integer;
  supplied_feature_count integer;
  supplied_permission_count integer;
begin
  if not exists (
    select 1
    from public.platform_admins admin
    where admin.user_id = target_actor_user_id
      and admin.active
  ) then
    raise exception 'PLATFORM_ADMIN_REQUIRED';
  end if;

  if normalized_code !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' then
    raise exception 'INVALID_TEMPLATE_CODE';
  end if;
  if char_length(normalized_name) not between 2 and 100 then
    raise exception 'INVALID_TEMPLATE_NAME';
  end if;
  if not exists (
    select 1 from public.plans plan where plan.id = target_plan_id and plan.is_active
  ) then
    raise exception 'ACTIVE_PLAN_REQUIRED';
  end if;
  if jsonb_typeof(normalized_settings) <> 'object' or jsonb_typeof(normalized_theme) <> 'object' then
    raise exception 'INVALID_TEMPLATE_DEFAULTS';
  end if;
  if coalesce(normalized_settings->>'currency', '') !~ '^[A-Z]{3}$' then
    raise exception 'INVALID_TEMPLATE_CURRENCY';
  end if;
  if coalesce(normalized_settings->>'invoicePrefix', '') !~ '^[A-Za-z0-9-]{1,12}$' then
    raise exception 'INVALID_TEMPLATE_INVOICE_PREFIX';
  end if;
  if coalesce((normalized_settings->>'vatRate')::numeric, -1) < 0
     or coalesce((normalized_settings->>'vatRate')::numeric, 101) > 100 then
    raise exception 'INVALID_TEMPLATE_VAT_RATE';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_timezone_names timezone
    where timezone.name = normalized_settings->>'timezone'
  ) then
    raise exception 'INVALID_TEMPLATE_TIMEZONE';
  end if;
  if coalesce(normalized_theme->>'mode', '') not in ('dark', 'light') then
    raise exception 'INVALID_TEMPLATE_MODE';
  end if;
  if coalesce(normalized_theme->>'density', '') not in ('comfortable', 'compact') then
    raise exception 'INVALID_TEMPLATE_DENSITY';
  end if;
  if coalesce(normalized_theme->>'accentColor', '') !~ '^#[0-9A-Fa-f]{6}$' then
    raise exception 'INVALID_TEMPLATE_ACCENT';
  end if;
  if coalesce((normalized_theme->>'textScale')::numeric, 0) < 0.8
     or coalesce((normalized_theme->>'textScale')::numeric, 2) > 1.4 then
    raise exception 'INVALID_TEMPLATE_TEXT_SCALE';
  end if;
  if jsonb_typeof(target_features) <> 'array' or jsonb_typeof(target_permissions) <> 'array' then
    raise exception 'INVALID_TEMPLATE_MATRIX';
  end if;

  select count(*) into active_feature_count
  from public.features feature
  where feature.is_active;

  select count(distinct item->>'featureKey') into supplied_feature_count
  from jsonb_array_elements(target_features) item;

  if supplied_feature_count <> active_feature_count
     or exists (
       select 1
       from jsonb_array_elements(target_features) item
       left join public.features feature
         on feature.key = item->>'featureKey'
        and feature.is_active
       where feature.key is null
     ) then
    raise exception 'INCOMPLETE_TEMPLATE_FEATURE_MATRIX';
  end if;

  select count(distinct concat_ws(':', item->>'accessProfile', item->>'featureKey'))
  into supplied_permission_count
  from jsonb_array_elements(target_permissions) item;

  if supplied_permission_count <> active_feature_count * 3
     or exists (
       select 1
       from jsonb_array_elements(target_permissions) item
       left join public.features feature
         on feature.key = item->>'featureKey'
        and feature.is_active
       where feature.key is null
          or item->>'accessProfile' not in ('manager', 'employee', 'custom')
     ) then
    raise exception 'INCOMPLETE_TEMPLATE_PERMISSION_MATRIX';
  end if;

  if target_template_id is null then
    insert into public.workspace_templates (
      code,
      name,
      description,
      plan_id,
      is_active,
      is_default,
      settings_defaults,
      theme_defaults,
      created_by,
      updated_by
    ) values (
      normalized_code,
      normalized_name,
      btrim(coalesce(target_description, '')),
      target_plan_id,
      coalesce(target_is_active, true),
      coalesce(target_is_default, false),
      normalized_settings,
      normalized_theme,
      target_actor_user_id,
      target_actor_user_id
    )
    returning id, version into resolved_template_id, resolved_version;
  else
    update public.workspace_templates template
    set code = normalized_code,
        name = normalized_name,
        description = btrim(coalesce(target_description, '')),
        plan_id = target_plan_id,
        is_active = coalesce(target_is_active, true),
        is_default = coalesce(target_is_default, false),
        settings_defaults = normalized_settings,
        theme_defaults = normalized_theme,
        version = template.version + 1,
        updated_by = target_actor_user_id,
        updated_at = now()
    where template.id = target_template_id
    returning template.id, template.version into resolved_template_id, resolved_version;

    if resolved_template_id is null then
      raise exception 'TEMPLATE_NOT_FOUND';
    end if;
  end if;

  if coalesce(target_is_default, false) and coalesce(target_is_active, true) then
    update public.workspace_templates template
    set is_default = false,
        updated_by = target_actor_user_id,
        updated_at = now()
    where template.id <> resolved_template_id
      and template.is_default;
  end if;

  delete from public.workspace_template_features
  where template_id = resolved_template_id;

  insert into public.workspace_template_features (template_id, feature_key, enabled)
  select
    resolved_template_id,
    item->>'featureKey',
    coalesce((item->>'enabled')::boolean, false)
  from jsonb_array_elements(target_features) item;

  delete from public.workspace_template_permissions
  where template_id = resolved_template_id;

  insert into public.workspace_template_permissions (
    template_id,
    access_profile,
    feature_key,
    can_view,
    can_create,
    can_edit,
    can_delete,
    can_approve,
    can_export
  )
  select
    resolved_template_id,
    item->>'accessProfile',
    item->>'featureKey',
    coalesce((item->>'can_view')::boolean, false),
    coalesce((item->>'can_create')::boolean, false),
    coalesce((item->>'can_edit')::boolean, false),
    coalesce((item->>'can_delete')::boolean, false),
    coalesce((item->>'can_approve')::boolean, false),
    coalesce((item->>'can_export')::boolean, false)
  from jsonb_array_elements(target_permissions) item;

  insert into public.audit_logs (
    actor_user_id,
    action,
    entity_type,
    entity_id,
    metadata
  ) values (
    target_actor_user_id,
    case when target_template_id is null then 'workspace_template.created' else 'workspace_template.updated' end,
    'workspace_template',
    resolved_template_id::text,
    jsonb_build_object(
      'code', normalized_code,
      'name', normalized_name,
      'version', resolved_version,
      'plan_id', target_plan_id,
      'active', coalesce(target_is_active, true),
      'default', coalesce(target_is_default, false)
    )
  );

  return resolved_template_id;
end;
$function$;

create or replace function public.apply_workspace_template(
  target_workspace_id uuid,
  target_template_id uuid,
  target_actor_user_id uuid,
  target_owner_name text,
  target_owner_email text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  selected_template public.workspace_templates%rowtype;
  settings jsonb;
  theme jsonb;
begin
  if not exists (
    select 1
    from public.platform_admins admin
    where admin.user_id = target_actor_user_id
      and admin.active
  ) then
    raise exception 'PLATFORM_ADMIN_REQUIRED';
  end if;

  select template.* into selected_template
  from public.workspace_templates template
  where template.id = target_template_id
    and template.is_active
  for share;

  if selected_template.id is null then
    raise exception 'ACTIVE_TEMPLATE_REQUIRED';
  end if;

  if not exists (
    select 1 from public.workspaces workspace where workspace.id = target_workspace_id
  ) then
    raise exception 'WORKSPACE_NOT_FOUND';
  end if;

  if exists (
    select 1 from public.workspace_settings settings_row where settings_row.workspace_id = target_workspace_id
  ) or exists (
    select 1 from public.workspace_themes theme_row where theme_row.workspace_id = target_workspace_id
  ) or exists (
    select 1 from public.workspace_memberships membership where membership.workspace_id = target_workspace_id
  ) then
    raise exception 'WORKSPACE_ALREADY_CONFIGURED';
  end if;

  settings := selected_template.settings_defaults;
  theme := selected_template.theme_defaults;

  update public.workspaces workspace
  set plan_id = selected_template.plan_id,
      workspace_template_id = selected_template.id,
      workspace_template_version = selected_template.version,
      updated_at = now()
  where workspace.id = target_workspace_id;

  insert into public.workspace_settings (
    workspace_id,
    owner_name,
    email,
    currency,
    invoice_prefix,
    vat_rate,
    timezone
  ) values (
    target_workspace_id,
    btrim(coalesce(target_owner_name, '')),
    nullif(btrim(coalesce(target_owner_email, '')), ''),
    settings->>'currency',
    settings->>'invoicePrefix',
    (settings->>'vatRate')::numeric,
    settings->>'timezone'
  );

  insert into public.workspace_themes (
    workspace_id,
    preset,
    mode,
    accent_color,
    font_family,
    text_scale,
    density,
    high_contrast,
    reduced_motion,
    updated_by
  ) values (
    target_workspace_id,
    theme->>'preset',
    theme->>'mode',
    theme->>'accentColor',
    theme->>'fontFamily',
    (theme->>'textScale')::numeric,
    theme->>'density',
    coalesce((theme->>'highContrast')::boolean, false),
    coalesce((theme->>'reducedMotion')::boolean, false),
    target_actor_user_id
  );

  insert into public.workspace_feature_overrides (
    workspace_id,
    feature_key,
    enabled,
    reason,
    starts_at,
    created_by
  )
  select
    target_workspace_id,
    feature.feature_key,
    feature.enabled,
    'Workspace template ' || selected_template.code || ' v' || selected_template.version,
    now(),
    target_actor_user_id
  from public.workspace_template_features feature
  where feature.template_id = selected_template.id;

  insert into public.workspace_access_profile_permissions (
    workspace_id,
    access_profile,
    feature_key,
    can_view,
    can_create,
    can_edit,
    can_delete,
    can_approve,
    can_export,
    source_template_id,
    source_template_version
  )
  select
    target_workspace_id,
    permission.access_profile,
    permission.feature_key,
    permission.can_view,
    permission.can_create,
    permission.can_edit,
    permission.can_delete,
    permission.can_approve,
    permission.can_export,
    selected_template.id,
    selected_template.version
  from public.workspace_template_permissions permission
  where permission.template_id = selected_template.id;

  insert into public.audit_logs (
    workspace_id,
    actor_user_id,
    action,
    entity_type,
    entity_id,
    metadata
  ) values (
    target_workspace_id,
    target_actor_user_id,
    'workspace.template_applied',
    'workspace_template',
    selected_template.id::text,
    jsonb_build_object(
      'template_code', selected_template.code,
      'template_version', selected_template.version,
      'plan_id', selected_template.plan_id
    )
  );

  return jsonb_build_object(
    'templateId', selected_template.id,
    'templateCode', selected_template.code,
    'templateVersion', selected_template.version,
    'planId', selected_template.plan_id
  );
end;
$function$;

revoke all on function public.save_workspace_template(uuid, uuid, text, text, text, uuid, boolean, boolean, jsonb, jsonb, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.apply_workspace_template(uuid, uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.save_workspace_template(uuid, uuid, text, text, text, uuid, boolean, boolean, jsonb, jsonb, jsonb, jsonb) to service_role;
grant execute on function public.apply_workspace_template(uuid, uuid, uuid, text, text) to service_role;

comment on function public.save_workspace_template(uuid, uuid, text, text, text, uuid, boolean, boolean, jsonb, jsonb, jsonb, jsonb) is
  'Service-role-only transactional command for creating or versioning a complete Founder workspace template.';
comment on function public.apply_workspace_template(uuid, uuid, uuid, text, text) is
  'Service-role-only provisioning command that snapshots one active template into a new, otherwise unconfigured workspace.';
