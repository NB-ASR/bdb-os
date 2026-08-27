begin;
select plan(4);

select ok(
  private.calendar_local_time_exists('2026-03-29', '00:30', 'Europe/London'),
  'UK time before the spring DST gap is valid'
);
select isnt(
  private.calendar_local_time_exists('2026-03-29', '01:30', 'Europe/London'),
  true,
  'UK spring-forward local time that never occurs is rejected'
);
select ok(
  private.calendar_local_time_exists('2026-03-29', '02:30', 'Europe/London'),
  'UK time after the spring DST gap is valid'
);
select ok(
  private.calendar_local_time_exists('2026-10-25', '01:30', 'Europe/London'),
  'UK repeated autumn wall-clock time remains a stable local Appointment value'
);

select * from finish();
rollback;
