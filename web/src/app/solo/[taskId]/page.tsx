"use client";

import dynamic from "next/dynamic";

const SoloReplayContent = dynamic(
  () => import("./SoloReplayContent"),
  { ssr: false }
);

export default function HelmReplayPage() {
  return <SoloReplayContent />;
}
