import type { Metadata } from "next";
import ClientExperiencePreview from "./client-experience-preview";
import "./v21-polish.css";
import "./v21-premium-audit.css";
import "./v21-desktop-flowline.css";
import "./v21-layout-bugfix.css";
import "./v21-containment-fixes.css";
import "./v21-pulse-dial.css";
import "./v21-pulse-dial-tuning.css";

export const metadata: Metadata = {
  title: "Client Experience V2.1 Preview · BDB OS",
  description: "An isolated interactive BDB OS prototype for premium motion, offline behaviour and client customisation review.",
  robots: { index: false, follow: false },
};

export default function DesignPreviewPage() {
  return <ClientExperiencePreview />;
}
