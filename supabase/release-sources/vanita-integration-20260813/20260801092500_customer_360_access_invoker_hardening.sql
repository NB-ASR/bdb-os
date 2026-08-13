begin;

alter function public.get_customer_360_access(uuid) security invoker;

comment on function public.get_customer_360_access(uuid) is
  'Returns source-department Customer 360 view access using the signed-in caller context; never elevates privileges.';

commit;
