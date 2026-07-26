-- Keep the automatic RLS event-trigger helper internal to the database.
-- Browser-facing roles must not be able to invoke this SECURITY DEFINER function through RPC.

revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
