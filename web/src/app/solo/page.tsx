"use client";

import dynamic from "next/dynamic";

const SoloLayout = dynamic(
  () => import("@/components/solo/SoloLayout"),
  { ssr: false }
);

export default function SoloPage() {
  return <SoloLayout />;
}
