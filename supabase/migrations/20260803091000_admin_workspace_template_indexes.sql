create index if not exists workspace_templates_created_by_idx
  on public.workspace_templates (created_by)
  where created_by is not null;

create index if not exists workspace_templates_updated_by_idx
  on public.workspace_templates (updated_by)
  where updated_by is not null;

comment on index public.workspace_templates_created_by_idx is
  'Covers the template creator audit foreign key without indexing null seeded rows.';
comment on index public.workspace_templates_updated_by_idx is
  'Covers the template updater audit foreign key without indexing null seeded rows.';
