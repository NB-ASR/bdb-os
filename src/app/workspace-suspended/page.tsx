import { ShieldCheck } from "lucide-react";
import { BdbMonogram } from "@/components/brand";

export default function WorkspaceSuspendedPage() { return <main className="mfa-shell"><BdbMonogram /><section className="mfa-card"><span className="mfa-icon"><ShieldCheck /></span><p className="marketing-kicker">Account status</p><h1>This workspace is paused.</h1><p>Please contact BDB OS support to review the contract or subscription status. Your business data remains safely stored.</p><a className="marketing-primary" href="mailto:support@bdb-os.com">Contact support</a></section></main>; }
