begin;

drop policy if exists "Supplier documents Accounts read" on public.supplier_documents;
drop policy if exists "Supplier documents permission read" on public.supplier_documents;
create policy "Supplier documents permission read"
on public.supplier_documents for select to authenticated
using (
  private.has_workspace_permission(workspace_id, 'purchasing', 'view')
  or private.has_workspace_permission(workspace_id, 'accounts', 'view')
);

drop policy if exists "Suppliers Accounts read" on public.suppliers;
drop policy if exists "Suppliers permission read" on public.suppliers;
create policy "Suppliers permission read"
on public.suppliers for select to authenticated
using (
  private.has_workspace_permission(workspace_id, 'suppliers', 'view')
  or private.has_workspace_permission(workspace_id, 'accounts', 'view')
);

comment on policy "Supplier documents permission read" on public.supplier_documents is
  'One combined RLS read boundary for Purchasing source-document users and Accounts Payable users.';
comment on policy "Suppliers permission read" on public.suppliers is
  'One combined RLS read boundary for Supplier-directory users and Accounts Payable users.';

commit;
