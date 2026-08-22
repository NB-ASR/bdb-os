#!/usr/bin/env bash
set -euo pipefail

DB_CONTAINER="$(docker ps --format '{{.Names}}' | grep '^supabase_db_' | head -n 1)"
if [[ -z "${DB_CONTAINER}" ]]; then
  echo "Supabase database container was not found" >&2
  exit 1
fi

psql_exec() {
  docker exec -i "${DB_CONTAINER}" psql -U postgres -d postgres -v ON_ERROR_STOP=1 "$@"
}

WORKSPACE="51000000-0000-4000-8000-000000000001"
USER_ID="51000000-0000-4000-8000-000000000002"
CUSTOMER="51000000-0000-4000-8000-000000000003"

psql_exec <<SQL
insert into auth.users(id,email) values ('${USER_ID}'::uuid,'pass4-concurrency@bdb.invalid');
insert into public.profiles(id,full_name,is_active) values ('${USER_ID}'::uuid,'Pass 4 Concurrency Actor',true);
insert into public.workspaces(id,slug,name) values ('${WORKSPACE}'::uuid,'pass4-concurrency','Pass 4 Concurrency');
update public.workspaces
set status='active',
    plan_id=(select plan_id from public.workspaces where slug='bdb-os')
where id='${WORKSPACE}'::uuid;
insert into public.workspace_memberships(workspace_id,user_id,role,status,access_profile,joined_at)
values ('${WORKSPACE}'::uuid,'${USER_ID}'::uuid,'owner','active','owner',now());
insert into public.customers(id,workspace_id,code,name,company)
values ('${CUSTOMER}'::uuid,'${WORKSPACE}'::uuid,'P4-CONC','Pass 4 Concurrency Customer','');

-- Payment-allocation race fixture.
insert into public.invoices(id,workspace_id,number,customer_id,due_at,description,amount,status,currency,customer_code_snapshot,customer_name_snapshot,gross_amount,discount_amount,net_amount,vat_amount,total_amount,created_by,updated_by)
values ('52000000-0000-4000-8000-000000000001'::uuid,'${WORKSPACE}'::uuid,'DRAFT-P4-PAY','${CUSTOMER}'::uuid,null,'Concurrency payment invoice',100,'draft','EUR','P4-CONC','Pass 4 Concurrency Customer',100,0,100,0,100,'${USER_ID}'::uuid,'${USER_ID}'::uuid);
insert into public.invoice_lines(id,workspace_id,invoice_id,line_number,line_type,code_snapshot,description_snapshot,quantity,unit_price,gross_amount,discount_amount,net_amount,vat_rate,vat_amount,total_amount)
values ('52000000-0000-4000-8000-000000000002'::uuid,'${WORKSPACE}'::uuid,'52000000-0000-4000-8000-000000000001'::uuid,1,'manual','P4-PAY','Payment race line',10,10,100,0,100,0,0,100);
update public.invoices set status='sent' where id='52000000-0000-4000-8000-000000000001'::uuid;
insert into public.payments(id,workspace_id,reference,customer_id,customer_code_snapshot,customer_name_snapshot,currency,amount,payment_method,received_at,posted_by)
values ('52000000-0000-4000-8000-000000000003'::uuid,'${WORKSPACE}'::uuid,'P4-CONC-PAY','${CUSTOMER}'::uuid,'P4-CONC','Pass 4 Concurrency Customer','EUR',100,'bank_transfer',now(),'${USER_ID}'::uuid);

-- Credit-creation race fixture.
insert into public.invoices(id,workspace_id,number,customer_id,due_at,description,amount,status,currency,customer_code_snapshot,customer_name_snapshot,gross_amount,discount_amount,net_amount,vat_amount,total_amount,created_by,updated_by)
values ('53000000-0000-4000-8000-000000000001'::uuid,'${WORKSPACE}'::uuid,'DRAFT-P4-CN','${CUSTOMER}'::uuid,null,'Concurrency credit invoice',100,'draft','EUR','P4-CONC','Pass 4 Concurrency Customer',100,0,100,0,100,'${USER_ID}'::uuid,'${USER_ID}'::uuid);
insert into public.invoice_lines(id,workspace_id,invoice_id,line_number,line_type,code_snapshot,description_snapshot,quantity,unit_price,gross_amount,discount_amount,net_amount,vat_rate,vat_amount,total_amount)
values ('53000000-0000-4000-8000-000000000002'::uuid,'${WORKSPACE}'::uuid,'53000000-0000-4000-8000-000000000001'::uuid,1,'manual','P4-CN','Credit race line',10,10,100,0,100,0,0,100);
update public.invoices set status='sent' where id='53000000-0000-4000-8000-000000000001'::uuid;

-- Delivery Note race fixture: both draft notes try to deliver six of ten units.
insert into public.invoices(id,workspace_id,number,customer_id,due_at,description,amount,status,currency,customer_code_snapshot,customer_name_snapshot,gross_amount,discount_amount,net_amount,vat_amount,total_amount,created_by,updated_by)
values ('54000000-0000-4000-8000-000000000001'::uuid,'${WORKSPACE}'::uuid,'DRAFT-P4-DN','${CUSTOMER}'::uuid,null,'Concurrency delivery invoice',100,'draft','EUR','P4-CONC','Pass 4 Concurrency Customer',100,0,100,0,100,'${USER_ID}'::uuid,'${USER_ID}'::uuid);
insert into public.invoice_lines(id,workspace_id,invoice_id,line_number,line_type,code_snapshot,description_snapshot,quantity,unit_price,gross_amount,discount_amount,net_amount,vat_rate,vat_amount,total_amount)
values ('54000000-0000-4000-8000-000000000002'::uuid,'${WORKSPACE}'::uuid,'54000000-0000-4000-8000-000000000001'::uuid,1,'manual','P4-DN','Delivery race line',10,10,100,0,100,0,0,100);
update public.invoices set status='sent' where id='54000000-0000-4000-8000-000000000001'::uuid;
insert into public.delivery_notes(id,workspace_id,number,source_invoice_id,customer_id,customer_name_snapshot,delivery_date,status,created_by,updated_by)
values
('54000000-0000-4000-8000-000000000003'::uuid,'${WORKSPACE}'::uuid,'DRAFT-DN-A','54000000-0000-4000-8000-000000000001'::uuid,'${CUSTOMER}'::uuid,'Pass 4 Concurrency Customer',current_date,'draft','${USER_ID}'::uuid,'${USER_ID}'::uuid),
('54000000-0000-4000-8000-000000000004'::uuid,'${WORKSPACE}'::uuid,'DRAFT-DN-B','54000000-0000-4000-8000-000000000001'::uuid,'${CUSTOMER}'::uuid,'Pass 4 Concurrency Customer',current_date,'draft','${USER_ID}'::uuid,'${USER_ID}'::uuid);
insert into public.delivery_note_lines(id,workspace_id,delivery_note_id,source_invoice_line_id,line_number,line_type,code_snapshot,description_snapshot,quantity)
values
('54000000-0000-4000-8000-000000000005'::uuid,'${WORKSPACE}'::uuid,'54000000-0000-4000-8000-000000000003'::uuid,'54000000-0000-4000-8000-000000000002'::uuid,1,'manual','P4-DN','Delivery race line',6),
('54000000-0000-4000-8000-000000000006'::uuid,'${WORKSPACE}'::uuid,'54000000-0000-4000-8000-000000000004'::uuid,'54000000-0000-4000-8000-000000000002'::uuid,1,'manual','P4-DN','Delivery race line',6);
SQL

CAN_WRITE="$(psql_exec -Atc "select private.accounts_actor_can_write('${WORKSPACE}'::uuid,'${USER_ID}'::uuid,'edit');")"
[[ "${CAN_WRITE}" == "t" ]] || { echo "Concurrency actor does not have Accounts edit permission" >&2; exit 1; }

run_parallel_pair() {
  local sql_a="$1"
  local sql_b="$2"
  local label="$3"
  local a_out="/tmp/pass4-${label}-a.out"
  local b_out="/tmp/pass4-${label}-b.out"
  local a_err="/tmp/pass4-${label}-a.err"
  local b_err="/tmp/pass4-${label}-b.err"

  set +e
  docker exec "${DB_CONTAINER}" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -Atc "${sql_a}" >"${a_out}" 2>"${a_err}" &
  local pid_a=$!
  docker exec "${DB_CONTAINER}" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -Atc "${sql_b}" >"${b_out}" 2>"${b_err}" &
  local pid_b=$!
  wait "${pid_a}"; local status_a=$?
  wait "${pid_b}"; local status_b=$?
  set -e

  local successes=0
  [[ ${status_a} -eq 0 ]] && successes=$((successes + 1))
  [[ ${status_b} -eq 0 ]] && successes=$((successes + 1))
  if [[ ${successes} -ne 1 ]]; then
    echo "${label}: expected exactly one concurrent command to succeed; got ${successes}" >&2
    cat "${a_err}" "${b_err}" >&2 || true
    exit 1
  fi
  echo "${label}: one mutation committed and the competing over-capacity mutation was rejected"
}

run_parallel_pair \
"select public.allocate_payment('${WORKSPACE}'::uuid,'52100000-0000-4000-8000-000000000001'::uuid,'52000000-0000-4000-8000-000000000003'::uuid,'52000000-0000-4000-8000-000000000001'::uuid,60,'pass4-conc-pay-a','${USER_ID}'::uuid,'52100000-0000-4000-8000-000000000011'::uuid,now());" \
"select public.allocate_payment('${WORKSPACE}'::uuid,'52100000-0000-4000-8000-000000000002'::uuid,'52000000-0000-4000-8000-000000000003'::uuid,'52000000-0000-4000-8000-000000000001'::uuid,60,'pass4-conc-pay-b','${USER_ID}'::uuid,'52100000-0000-4000-8000-000000000012'::uuid,now());" \
"payment-allocation"

PAY_ALLOCATED="$(psql_exec -Atc "select round(coalesce(sum(amount_delta),0),4) from public.payment_allocations where workspace_id='${WORKSPACE}'::uuid and payment_id='52000000-0000-4000-8000-000000000003'::uuid;")"
[[ "${PAY_ALLOCATED}" == "60.0000" ]] || { echo "Concurrent Payment allocation total was ${PAY_ALLOCATED}, expected 60.0000" >&2; exit 1; }

run_parallel_pair \
"select public.create_and_issue_credit_note_command('${WORKSPACE}'::uuid,'53100000-0000-4000-8000-000000000001'::uuid,'pass4-conc-cn-a','${USER_ID}'::uuid,'53100000-0000-4000-8000-000000000011'::uuid,'53000000-0000-4000-8000-000000000001'::uuid,'Concurrent credit A','[{\"id\":\"53100000-0000-4000-8000-000000000021\",\"sourceInvoiceLineId\":\"53000000-0000-4000-8000-000000000002\",\"quantity\":6}]'::jsonb);" \
"select public.create_and_issue_credit_note_command('${WORKSPACE}'::uuid,'53100000-0000-4000-8000-000000000002'::uuid,'pass4-conc-cn-b','${USER_ID}'::uuid,'53100000-0000-4000-8000-000000000012'::uuid,'53000000-0000-4000-8000-000000000001'::uuid,'Concurrent credit B','[{\"id\":\"53100000-0000-4000-8000-000000000022\",\"sourceInvoiceLineId\":\"53000000-0000-4000-8000-000000000002\",\"quantity\":6}]'::jsonb);" \
"credit-note"

CREDIT_QTY="$(psql_exec -Atc "select round(coalesce(sum(line.quantity),0),4) from public.credit_note_lines line join public.credit_notes note on note.workspace_id=line.workspace_id and note.id=line.credit_note_id where line.workspace_id='${WORKSPACE}'::uuid and line.source_invoice_line_id='53000000-0000-4000-8000-000000000002'::uuid and note.status='issued';")"
[[ "${CREDIT_QTY}" == "6.0000" ]] || { echo "Concurrent Credit quantity was ${CREDIT_QTY}, expected 6.0000" >&2; exit 1; }

run_parallel_pair \
"update public.delivery_notes set status='issued',issued_by='${USER_ID}'::uuid,issued_at=now() where id='54000000-0000-4000-8000-000000000003'::uuid;" \
"update public.delivery_notes set status='issued',issued_by='${USER_ID}'::uuid,issued_at=now() where id='54000000-0000-4000-8000-000000000004'::uuid;" \
"delivery-note"

DELIVERED_QTY="$(psql_exec -Atc "select round(coalesce(sum(line.quantity),0),4) from public.delivery_note_lines line join public.delivery_notes note on note.workspace_id=line.workspace_id and note.id=line.delivery_note_id where line.workspace_id='${WORKSPACE}'::uuid and line.source_invoice_line_id='54000000-0000-4000-8000-000000000002'::uuid and note.status='issued';")"
[[ "${DELIVERED_QTY}" == "6.0000" ]] || { echo "Concurrent Delivery quantity was ${DELIVERED_QTY}, expected 6.0000" >&2; exit 1; }

# Forty simultaneous permanent-number allocations share one sequence row. Every
# result must be unique; gaps are acceptable after rolled-back/failed business work,
# but reuse and duplication are not.
rm -f /tmp/pass4-number-*.out
pids=()
for i in $(seq 1 40); do
  docker exec "${DB_CONTAINER}" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -Atc \
    "select private.next_business_document_number('${WORKSPACE}'::uuid,'invoice','TINV',current_date);" \
    >"/tmp/pass4-number-${i}.out" &
  pids+=("$!")
done
for pid in "${pids[@]}"; do wait "${pid}"; done
cat /tmp/pass4-number-*.out | sort > /tmp/pass4-numbers.txt
NUMBER_COUNT="$(wc -l < /tmp/pass4-numbers.txt | tr -d ' ')"
UNIQUE_COUNT="$(sort -u /tmp/pass4-numbers.txt | wc -l | tr -d ' ')"
[[ "${NUMBER_COUNT}" == "40" && "${UNIQUE_COUNT}" == "40" ]] || {
  echo "Permanent numbering concurrency failed: ${UNIQUE_COUNT}/${NUMBER_COUNT} unique" >&2
  cat /tmp/pass4-numbers.txt >&2
  exit 1
}
echo "numbering: 40/40 simultaneous permanent numbers were unique"

echo "Accounts Pass 4 concurrency torture passed"
