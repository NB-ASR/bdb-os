import type { Metadata } from "next";
import { SoloOperatorExperience } from "@/components/solo-operator-experience";

export const metadata: Metadata = {
  title: "Solo Operator",
  description: "A connected administrative operator for self-employed professionals.",
};

export default function SoloOperatorPage() {
  return <SoloOperatorExperience />;
}
