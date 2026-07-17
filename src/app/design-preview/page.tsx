import type { Metadata } from "next";
import ClientExperiencePreview from "./client-experience-preview";

export const metadata: Metadata = {
  title: "Client Experience V1 Preview",
  description: "An isolated BDB OS client workspace design prototype.",
  robots: {
    index: false,
    follow: false,
  },
};

export default function DesignPreviewPage() {
  return <ClientExperiencePreview />;
}
