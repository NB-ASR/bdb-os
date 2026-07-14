import Link from "next/link";
import { Building2 } from "lucide-react";
import { BdbMonogram } from "@/components/brand";

export default function NoWorkspacePage() { return <main className="mfa-shell"><BdbMonogram /><section className="mfa-card"><span className="mfa-icon"><Building2 /></span><p className="marketing-kicker">Workspace access</p><h1>No active workspace yet.</h1><p>Your invitation may still be pending, or a founder needs to assign you to a client workspace.</p><Link className="marketing-primary" href="/login">Sign in with another account</Link></section></main>; }
