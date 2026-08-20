import { Suspense } from "react";
import { CreditNoteComposer } from "@/components/accounts/credit-note-composer";

export default function NewCreditNotePage() {
  return <Suspense fallback={null}><CreditNoteComposer /></Suspense>;
}
