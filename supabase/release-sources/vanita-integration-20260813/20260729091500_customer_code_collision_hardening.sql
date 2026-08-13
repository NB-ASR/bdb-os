begin;

do $$
declare
  command_definition text;
  import_definition text;
begin
  select pg_get_functiondef(
    'public.apply_customer_command(uuid,uuid,text,text,uuid,uuid,integer,text,text,text,text,text,text,text,jsonb,boolean)'::regprocedure
  ) into command_definition;

  command_definition := replace(
    command_definition,
    'upper(substr(replace(p_customer_id::text, ''-'', ''''), 1, 8))',
    'upper(right(replace(p_customer_id::text, ''-'', ''''), 16))'
  );
  execute command_definition;

  select pg_get_functiondef(
    'public.import_vanita_customers(uuid,uuid,text,uuid,uuid,text,jsonb)'::regprocedure
  ) into import_definition;

  import_definition := replace(
    import_definition,
    'upper(substr(replace(new_customer_id::text, ''-'', ''''), 1, 8))',
    'upper(right(replace(new_customer_id::text, ''-'', ''''), 16))'
  );
  execute import_definition;

  if position(
    'right(replace(p_customer_id::text' in lower(pg_get_functiondef(
      'public.apply_customer_command(uuid,uuid,text,text,uuid,uuid,integer,text,text,text,text,text,text,text,jsonb,boolean)'::regprocedure
    ))
  ) = 0 then
    raise exception 'Customer lifecycle code generation was not hardened';
  end if;

  if position(
    'right(replace(new_customer_id::text' in lower(pg_get_functiondef(
      'public.import_vanita_customers(uuid,uuid,text,uuid,uuid,text,jsonb)'::regprocedure
    ))
  ) = 0 then
    raise exception 'Customer import code generation was not hardened';
  end if;
end;
$$;

revoke all on function public.apply_customer_command(uuid, uuid, text, text, uuid, uuid, integer, text, text, text, text, text, text, text, jsonb, boolean) from public, anon, authenticated;
grant execute on function public.apply_customer_command(uuid, uuid, text, text, uuid, uuid, integer, text, text, text, text, text, text, text, jsonb, boolean) to service_role;

revoke all on function public.import_vanita_customers(uuid, uuid, text, uuid, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.import_vanita_customers(uuid, uuid, text, uuid, uuid, text, jsonb) to service_role;

commit;
