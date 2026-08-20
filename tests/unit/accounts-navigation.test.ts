import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(path: string) {
  return readFile(path, "utf8");
}

test("Accounts navigation stays inside dedicated workspaces", async () => {
  const [overview, sales, payments, invoiceRegister, creditRegister, deliveryRegister] = await Promise.all([
    source("src/app/accounts/page.tsx"),
    source("src/app/accounts/sales/page.tsx"),
    source("src/app/accounts/payments/page.tsx"),
    source("src/app/accounts/sales/invoices/page.tsx"),
    source("src/app/accounts/sales/credit-notes/page.tsx"),
    source("src/app/accounts/sales/delivery-notes/page.tsx"),
  ]);

  assert.match(overview, /href="\/accounts\/sales\/invoices\/new"/);
  assert.doesNotMatch(overview, /href="\/accounts\/sales\/new"/);
  assert.match(overview, /href="\/accounts\/payments"/);
  assert.match(overview, /href="\/accounts\/customers"/);
  assert.doesNotMatch(sales, /href="\/accounts\/sales\/new"/);
  assert.doesNotMatch(sales, /Create a document|New document/);
  assert.match(sales, /href="\/accounts\/settings"/);
  assert.match(payments, /href="\/accounts\/payments\/new"/);
  assert.match(invoiceRegister, /href="\/accounts\/sales\/invoices\/new"/);
  assert.match(creditRegister, /href="\/accounts\/sales\/credit-notes\/new"/);
  assert.match(deliveryRegister, /href="\/accounts\/sales\/delivery-notes\/new"/);

  for (const page of [overview, sales, payments, invoiceRegister, creditRegister, deliveryRegister]) {
    assert.doesNotMatch(page, /\/accounts\/operations/);
  }
});

test("redundant Sales chooser is retired while dedicated final-first composers remain direct", async () => {
  const [chooser, invoiceRoute, creditRoute, deliveryRoute, paymentRoute] = await Promise.all([
    source("src/app/accounts/sales/new/page.tsx"),
    source("src/app/accounts/sales/invoices/new/page.tsx"),
    source("src/app/accounts/sales/credit-notes/new/page.tsx"),
    source("src/app/accounts/sales/delivery-notes/new/page.tsx"),
    source("src/app/accounts/payments/new/page.tsx"),
  ]);

  assert.match(chooser, /redirect\("\/accounts\/sales"\)/);
  assert.doesNotMatch(chooser, /\/accounts\/sales\/(?:invoices|credit-notes|delivery-notes)\/new/);
  assert.match(invoiceRoute, /InvoiceComposer/);
  assert.match(creditRoute, /CreditNoteComposer/);
  assert.match(deliveryRoute, /DeliveryNoteComposer/);
  assert.match(paymentRoute, /PaymentComposer/);
});

test("legacy Accounts operations route cannot leak its former workbench", async () => {
  const legacyRoute = await source("src/app/accounts/operations/page.tsx");
  assert.match(legacyRoute, /redirect\("\/accounts"\)/);
  assert.doesNotMatch(legacyRoute, /invoice-create-manual|payment-record|Credit Note register/);
});

test("Invoice detail keeps document actions and controlled connected state", async () => {
  const detail = await source("src/app/accounts/sales/invoices/[id]/page.tsx");
  assert.match(detail, /Original Invoice/);
  assert.match(detail, /Credit Notes/);
  assert.match(detail, /Payments/);
  assert.match(detail, /Remaining balance/);
  assert.match(detail, /document-note-add/);
  assert.match(detail, /credit-notes\/new\?invoiceId=/);
  assert.match(detail, /documentUrl\([^\n]+"pdf"\)/);
  assert.match(detail, /print/);
  assert.match(detail, /mailto:/);
});
