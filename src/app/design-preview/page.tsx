import type { Metadata } from "next";
import ClientExperiencePreview from "./client-experience-preview";

export const metadata: Metadata = {
  title: "Client Experience V2.1 Preview · BDB OS",
  description: "An isolated interactive BDB OS prototype for premium motion, offline behaviour and client customisation review.",
  robots: { index: false, follow: false },
};

export default function DesignPreviewPage() {
  return <ClientExperiencePreview />;
}
