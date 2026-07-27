-- Keep the automatic RLS event-trigger helper internal to the database.
-- Browser-facing roles must not be able to invoke this SECURITY DEFINER function through RPC.
-- Some clean migration replays do not contain the historical helper, so the revoke must be conditional.

do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    execute 'revoke execute on function public.rls_auto_enable() from public, anon, authenticated';
  end if;
end;
$$;
