-- Private workspace files. The first path segment is always the tenant UUID;
-- policies apply the same membership and feature checks used by table data.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('workspace-documents', 'workspace-documents', false, 20971520, array['application/pdf', 'image/png', 'image/jpeg', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']),
  ('workspace-assets', 'workspace-assets', false, 5242880, array['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create function private.storage_workspace_id(object_name text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
declare
  first_segment text := split_part(object_name, '/', 1);
begin
  if first_segment ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    return first_segment::uuid;
  end if;
  return null;
end;
$$;

revoke all on function private.storage_workspace_id(text) from public, anon;
grant execute on function private.storage_workspace_id(text) to authenticated;

create policy "Members can read workspace documents"
on storage.objects for select to authenticated
using (
  bucket_id = 'workspace-documents'
  and private.can_read_workspace(private.storage_workspace_id(name))
  and private.has_feature(private.storage_workspace_id(name), 'documents')
);

create policy "Members can upload workspace documents"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'workspace-documents'
  and private.can_write_workspace(private.storage_workspace_id(name))
  and private.has_feature(private.storage_workspace_id(name), 'documents')
);

create policy "Managers can update workspace documents"
on storage.objects for update to authenticated
using (
  bucket_id = 'workspace-documents'
  and private.can_manage_workspace(private.storage_workspace_id(name))
  and private.has_feature(private.storage_workspace_id(name), 'documents')
)
with check (
  bucket_id = 'workspace-documents'
  and private.can_manage_workspace(private.storage_workspace_id(name))
  and private.has_feature(private.storage_workspace_id(name), 'documents')
);

create policy "Managers can delete workspace documents"
on storage.objects for delete to authenticated
using (
  bucket_id = 'workspace-documents'
  and private.can_manage_workspace(private.storage_workspace_id(name))
  and private.has_feature(private.storage_workspace_id(name), 'documents')
);

create policy "Members can read workspace assets"
on storage.objects for select to authenticated
using (
  bucket_id = 'workspace-assets'
  and private.can_read_workspace(private.storage_workspace_id(name))
);

create policy "Managers can upload workspace assets"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'workspace-assets'
  and private.can_manage_workspace(private.storage_workspace_id(name))
  and private.has_feature(private.storage_workspace_id(name), 'appearance')
);

create policy "Managers can update workspace assets"
on storage.objects for update to authenticated
using (
  bucket_id = 'workspace-assets'
  and private.can_manage_workspace(private.storage_workspace_id(name))
  and private.has_feature(private.storage_workspace_id(name), 'appearance')
)
with check (
  bucket_id = 'workspace-assets'
  and private.can_manage_workspace(private.storage_workspace_id(name))
  and private.has_feature(private.storage_workspace_id(name), 'appearance')
);

create policy "Managers can delete workspace assets"
on storage.objects for delete to authenticated
using (
  bucket_id = 'workspace-assets'
  and private.can_manage_workspace(private.storage_workspace_id(name))
  and private.has_feature(private.storage_workspace_id(name), 'appearance')
);
