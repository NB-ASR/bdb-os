begin;

select plan(6);

select has_function(
  'private',
  'normalise_supplier_identity_name',
  array['text'],
  'Supplier identity-name normaliser exists'
);

select has_function(
  'public',
  'apply_supplier_document_review_with_supplier_proposal',
  array['uuid','uuid','text','text','uuid','uuid','integer','jsonb','jsonb'],
  'trusted supplier-proposal approval command exists'
);

select is(
  private.normalise_supplier_identity_name('PBLL Limited'),
  'pblllimited',
  'Supplier names are matched case-insensitively without spacing'
);

select is(
  private.normalise_supplier_identity_name('  PBLL-LIMITED  '),
  'pblllimited',
  'Supplier punctuation is normalised conservatively'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.apply_supplier_document_review_with_supplier_proposal(uuid,uuid,text,text,uuid,uuid,integer,jsonb,jsonb)',
    'EXECUTE'
  ),
  'service role can execute the trusted supplier-proposal command'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.apply_supplier_document_review_with_supplier_proposal(uuid,uuid,text,text,uuid,uuid,integer,jsonb,jsonb)',
    'EXECUTE'
  ),
  'browser clients cannot execute the supplier-proposal command directly'
);

select * from finish();
rollback;
