do $$
declare
  definition text;
  function_oid oid;
begin
  foreach function_oid in array array[
    'public.apply_invoice_command(uuid,uuid,text,text,uuid,uuid,integer,uuid,uuid,date,text,text,jsonb,text)'::regprocedure::oid,
    'public.reverse_payment_allocation(uuid,uuid,uuid,text,uuid,uuid,text,timestamp with time zone)'::regprocedure::oid,
    'public.reverse_payment(uuid,uuid,text,uuid,uuid,text)'::regprocedure::oid
  ]
  loop
    select pg_get_functiondef(function_oid) into definition;
    execute replace(definition, '''red''', '''neutral''');
  end loop;
end;
$$;
