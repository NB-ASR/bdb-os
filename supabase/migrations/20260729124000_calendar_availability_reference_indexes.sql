begin;

create index calendar_staff_working_hours_created_by_idx
  on public.calendar_staff_working_hours(created_by)
  where created_by is not null;

create index calendar_staff_working_hours_updated_by_idx
  on public.calendar_staff_working_hours(updated_by)
  where updated_by is not null;

drop index if exists public.calendar_staff_leave_staff_time_idx;

commit;
