begin;

select plan(8);

select has_function(
  'public',
  'apply_supplier_document_review',
  array['uuid','uuid','text','text','uuid','uuid','integer','jsonb','jsonb'],
  'supplier-document review command remains available'
);

select ok(
  position('insert into public.products' in lower(pg_get_functiondef(
    'public.apply_supplier_document_review(uuid,uuid,text,text,uuid,uuid,integer,jsonb,jsonb)'::regprocedure
  ))) > 0,
  'approval can create a canonical Product from a reviewed invoice line'
);

select ok(
  position('insert into public.product_suppliers' in lower(pg_get_functiondef(
    'public.apply_supplier_document_review(uuid,uuid,text,text,uuid,uuid,integer,jsonb,jsonb)'::regprocedure
  ))) > 0,
  'approval can create the Product-Supplier relationship'
);

select ok(
  position('product_uuid <> line_uuid' in lower(pg_get_functiondef(
    'public.apply_supplier_document_review(uuid,uuid,text,text,uuid,uuid,integer,jsonb,jsonb)'::regprocedure
  ))) > 0,
  'new Product creation requires the deterministic document-line identity'
);

select ok(
  position('supplier_document_command_receipts' in lower(pg_get_functiondef(
    'public.apply_supplier_document_review(uuid,uuid,text,text,uuid,uuid,integer,jsonb,jsonb)'::regprocedure
  ))) > 0,
  'approval remains idempotent'
);

select ok(
  position('existing product already uses this barcode' in lower(pg_get_functiondef(
    'public.apply_supplier_document_review(uuid,uuid,text,text,uuid,uuid,integer,jsonb,jsonb)'::regprocedure
  ))) > 0,
  'barcode conflicts stop automatic Product creation'
);

select ok(
  position('supplier sku is already linked to another product' in lower(pg_get_functiondef(
    'public.apply_supplier_document_review(uuid,uuid,text,text,uuid,uuid,integer,jsonb,jsonb)'::regprocedure
  ))) > 0,
  'Supplier-SKU conflicts stop duplicate catalogue creation'
);

select ok(
  position('product created from supplier document' in lower(pg_get_functiondef(
    'public.apply_supplier_document_review(uuid,uuid,text,text,uuid,uuid,integer,jsonb,jsonb)'::regprocedure
  ))) > 0,
  'invoice-created Products write Activity history'
);

select * from finish();
rollback;
