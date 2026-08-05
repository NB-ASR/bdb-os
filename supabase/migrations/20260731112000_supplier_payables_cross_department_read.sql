begin;

drop policy if exists "Supplier documents Accounts read" on public.supplier_documents;
create policy "Supplier documents Accounts read"
on public.supplier_documents for select to authenticated
using (private.has_workspace_permission(workspace_id, 'accounts', 'view'));

drop policy if exists "Suppliers Accounts read" on public.suppliers;
create policy "Suppliers Accounts read"
on public.suppliers for select to authenticated
using (private.has_workspace_permission(workspace_id, 'accounts', 'view'));

comment on policy "Supplier documents Accounts read" on public.supplier_documents is
  'Accounts users may read approved Purchasing source documents for explicit payable posting.';
comment on policy "Suppliers Accounts read" on public.suppliers is
  'Accounts users may read Supplier identities for Payments and balance reporting.';

commit;
