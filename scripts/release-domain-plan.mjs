export const releaseSourceDirectory =
  "supabase/release-sources/vanita-integration-20260813";

export const domainMigrations = [
  {
    file: "20260813133407_vanita_release_prerequisites_and_features.sql",
    firstSource: "20260726135542_revoke_rls_auto_enable_execute.sql",
    lastSource: "20260727134000_calendar_department_draft_modules.sql",
  },
  {
    file: "20260813133410_vanita_release_catalogues_and_suppliers.sql",
    firstSource: "20260727152000_product_catalogue_foundation.sql",
    lastSource: "20260727155000_product_supplier_relationship.sql",
  },
  {
    file: "20260813133415_vanita_release_purchasing_documents_and_inventory.sql",
    firstSource: "20260727161000_supplier_document_capture_review.sql",
    lastSource: "20260727190500_inventory_reference_indexes.sql",
  },
  {
    file: "20260813133419_vanita_release_services_sales_and_purchase_creation.sql",
    firstSource: "20260728090000_service_catalogue_foundation.sql",
    lastSource: "20260728160000_purchasing_create_products_from_invoice.sql",
  },
  {
    file: "20260813133422_vanita_release_customer_foundation.sql",
    firstSource: "20260729085000_actor_workspace_permission.sql",
    lastSource: "20260729092000_customer_reference_indexes.sql",
  },
  {
    file: "20260813133425_vanita_release_appointments_and_calendar.sql",
    firstSource: "20260729110000_appointment_status_values.sql",
    lastSource: "20260729150000_appointment_product_consumption.sql",
  },
  {
    file: "20260813133429_vanita_release_customer_accounts.sql",
    firstSource: "20260729160000_invoice_status_void_value.sql",
    lastSource: "20260729163500_accounts_reference_index_hardening.sql",
  },
  {
    file: "20260813133434_vanita_release_purchasing_and_supplier_payables.sql",
    firstSource: "20260731100000_purchasing_supplier_proposal.sql",
    lastSource: "20260731113000_supplier_payables_read_policy_hardening.sql",
  },
  {
    file: "20260813133442_vanita_release_banking_reconciliation.sql",
    firstSource: "20260731120000_banking_reconciliation_schema.sql",
    lastSource: "20260731121500_banking_reference_indexes.sql",
  },
  {
    file: "20260813133446_vanita_release_customer_360.sql",
    firstSource: "20260801090000_customer_360_notes_schema.sql",
    lastSource: "20260801093000_customer_360_index_deduplication.sql",
  },
  {
    file: "20260813133451_vanita_release_documents_and_communications.sql",
    firstSource: "20260801110000_general_documents_foundation.sql",
    lastSource: "20260801133500_unified_communications_reference_indexes.sql",
  },
  {
    file: "20260813133455_vanita_release_business_hub_workspace_and_admin.sql",
    firstSource: "20260802140000_business_hub_access_and_metrics.sql",
    lastSource: "20260805131000_revoke_anonymous_operational_settings.sql",
  },
];

export function domainMigrationHeader(group, sourceFiles) {
  return [
    "-- Ordered release-domain migration reconstructed from preserved sources.",
    `-- Domain: ${group.file.replace(/^\\d+_|\\.sql$/g, "")}.`,
    `-- Sources: ${sourceFiles[0]} through ${sourceFiles.at(-1)}.`,
    "",
  ].join("\n");
}
