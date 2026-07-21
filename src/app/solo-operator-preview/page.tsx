import type { Metadata } from "next";
import { SoloOperatorExperience } from "@/components/solo-operator-experience";

export const metadata: Metadata = {
  title: "Solo Operator Preview",
  description: "Founder review environment for the BDB Solo Operator tier.",
  robots: { index: false, follow: false },
};

export default function SoloOperatorPreviewPage() {
  return <SoloOperatorExperience />;
}
