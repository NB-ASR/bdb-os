-- Remove the non-constraint duplicate of the Documents workspace identity
-- index. documents_workspace_id_id_key remains as the unique-constraint
-- backing index for the same (workspace_id, id) key.

drop index if exists public.documents_workspace_id_id_uidx;
