"use client";

import dynamic from "next/dynamic";

const HelmLayout = dynamic(
  () => import("@/components/helm/HelmLayout"),
  { ssr: false }
);

export default function HelmPage() {
  return <HelmLayout />;
}
