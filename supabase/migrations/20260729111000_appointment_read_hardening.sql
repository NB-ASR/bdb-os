revoke all on table public.bookings from anon;
revoke all on table public.appointment_command_receipts from anon, authenticated;

comment on table public.bookings is
  'Canonical workspace Appointment records. Authenticated reads remain RLS-scoped; anonymous access is denied; mutations use trusted commands only.';
