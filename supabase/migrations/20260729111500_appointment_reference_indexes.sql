drop index if exists public.bookings_workspace_date_time_idx;

create index if not exists bookings_staff_user_idx
  on public.bookings(staff_user_id)
  where staff_user_id is not null;

comment on index public.bookings_staff_user_idx is
  'Covers the Appointment staff profile foreign key and staff lifecycle lookups.';
