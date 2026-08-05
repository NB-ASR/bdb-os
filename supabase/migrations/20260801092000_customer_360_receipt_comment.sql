begin;

-- Receipt tables remain service-role-only and intentionally expose no authenticated policies.
-- Keep this explicit in database inspection so the no-policy state is not mistaken for a missing browser rule.
comment on table public.customer_note_command_receipts is
  'Service-role-only idempotency receipts for append-only Customer note commands; authenticated access is intentionally denied.';

commit;
