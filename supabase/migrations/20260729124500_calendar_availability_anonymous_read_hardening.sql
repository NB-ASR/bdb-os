begin;

revoke all on table public.calendar_rooms from anon;
revoke all on table public.calendar_staff_working_hours from anon;
revoke all on table public.calendar_staff_breaks from anon;
revoke all on table public.calendar_staff_leave from anon;
revoke all on table public.calendar_availability_command_receipts from anon;

commit;
