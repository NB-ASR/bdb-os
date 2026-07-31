import PurchasingAccountsStatus from "./purchasing-accounts-status";
import PurchasingInventoryStatus from "./purchasing-inventory-status";
import PurchasingWorkspace from "./purchasing-workspace";
import styles from "./page.module.css";

export default function PurchasingPage() {
  return (
    <div className={styles.page}>
      <PurchasingInventoryStatus />
      <PurchasingAccountsStatus />
      <PurchasingWorkspace />
    </div>
  );
}
