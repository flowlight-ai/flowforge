import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "群聊 — FlowForge",
  description: "5 个可进化智能体（Forgekin）协作群聊频道",
};

export default function CouncilLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
