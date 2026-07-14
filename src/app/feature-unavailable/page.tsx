import Link from "next/link";
import { LockKeyhole } from "lucide-react";
import { BdbMonogram } from "@/components/brand";

export default async function FeatureUnavailablePage({ searchParams }: { searchParams: Promise<{ feature?: string }> }) { const { feature } = await searchParams; return <main className="mfa-shell"><BdbMonogram /><section className="mfa-card"><span className="mfa-icon"><LockKeyhole /></span><p className="marketing-kicker">Plan entitlement</p><h1>This module is not enabled.</h1><p>{feature ? `${feature[0].toUpperCase()}${feature.slice(1)}` : "This feature"} is not included in the workspace’s current plan or client overrides. A workspace owner can ask BDB OS to add it.</p><Link className="marketing-primary" href="/workspace">Return to workspace</Link></section></main>; }
