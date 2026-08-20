import { redirect } from "next/navigation";

export default function LegacyAccountsOperationsRedirect() {
  redirect("/accounts");
}
