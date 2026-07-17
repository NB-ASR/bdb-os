alter table public.workspace_themes
  drop constraint if exists workspace_themes_preset_check;

alter table public.workspace_themes
  add constraint workspace_themes_preset_check
  check (
    preset = any (
      array[
        'bdb'::text,
        'obsidian-gold'::text,
        'slate'::text,
        'ocean'::text,
        'forest'::text,
        'plum'::text,
        'clay'::text,
        'custom'::text
      ]
    )
  );
