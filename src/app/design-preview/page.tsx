import type { Metadata } from "next";
import ClientExperiencePreview from "./client-experience-preview";

export const metadata: Metadata = {
  title: "Client Experience V2 Preview · BDB OS",
  description: "A fully interactive, isolated BDB OS client workspace design prototype for founder review.",
  robots: {
    index: false,
    follow: false,
  },
};

export default function DesignPreviewPage() {
  return <ClientExperiencePreview />;
}
