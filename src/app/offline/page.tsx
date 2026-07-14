import Link from "next/link";
import { RefreshCw, WifiOff } from "lucide-react";
import { BdbBrand } from "@/components/bdb-brand";

export default function OfflinePage() {
  return <main className="offline-page"><BdbBrand /><WifiOff size={42} /><h1>You’re offline</h1><p>BDB OS protects private workspace pages from being stored in a shared browser cache. Reconnect to securely reopen live business records.</p><Link href="/workspace" className="button button-primary"><RefreshCw size={16} /> Try again</Link></main>;
}
