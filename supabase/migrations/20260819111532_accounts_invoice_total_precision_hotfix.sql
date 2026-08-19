-- Keep canonical Invoice totals at four decimals while allowing the legacy
-- two-decimal amount mirror to agree at normal currency precision.
-- This prevents valid VAT calculations with fractional cents from blocking
-- final-first Invoice creation.

alter table public.invoices drop constraint if exists invoices_totals_check;

alter table public.invoices add constraint invoices_totals_check check (
  gross_amount >= 0
  and discount_amount >= 0
  and discount_amount <= gross_amount
  and net_amount >= 0
  and vat_amount >= 0
  and total_amount >= 0
  and round(net_amount + vat_amount, 4) = round(total_amount, 4)
  and round(amount, 2) = round(total_amount, 2)
);
