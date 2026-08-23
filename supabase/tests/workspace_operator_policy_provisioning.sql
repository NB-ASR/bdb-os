begin;

select plan(5);

select has_function(
  'private',
  'sync_workspace_operator_policies',
  array[]::text[],
  'Workspace operator-policy synchronisation trigger exists'
);

select ok(
  position('resolved_blueprint_key' in pg_get_functiondef('private.sync_workspace_operator_policies()'::regprocedure)) = 0,
  'Trigger does not reference nonexistent resolved_blueprint columns'
);

select ok(
  position('blueprint_key' in pg_get_functiondef('private.sync_workspace_operator_policies()'::regprocedure)) > 0
    and position('blueprint_version' in pg_get_functiondef('private.sync_workspace_operator_policies()'::regprocedure)) > 0,
  'Trigger writes the real operator policy blueprint columns'
);

select ok(
  not has_function_privilege('anon', 'private.sync_workspace_operator_policies()', 'execute'),
  'Anonymous users cannot execute the internal trigger function'
);

select ok(
  not has_function_privilege('authenticated', 'private.sync_workspace_operator_policies()', 'execute'),
  'Authenticated users cannot execute the internal trigger function'
);

select * from finish();
rollback;
