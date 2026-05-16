"use client";

import { usePathname } from "next/navigation";
import { useShellConfig } from "../lib/shell-config";
import Sidebar from "./Sidebar";

export default function ShellWrapper({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const config = useShellConfig();
  const isSolo = pathname.startsWith("/solo");

  if (isSolo) {
    return <>{children}</>;
  }

  return (
    <div
      style={{
        height: "100vh",
        display: "grid",
        gridTemplateColumns: "var(--shell-nav-width, 258px) minmax(0, 1fr)",
        gridTemplateRows: "var(--shell-topbar-height, 52px) 1fr",
        gridTemplateAreas: `"nav topbar" "nav content"`,
        overflow: "hidden",
      }}
    >
      <header className="shell-nav" style={{ gridArea: "nav" }}>
        <Sidebar />
      </header>
      <div className="topbar" style={{ gridArea: "topbar" }}>
        <div className="topbar-brand">
          <span>{config.brandName}</span>
        </div>
        <div className="topbar-spacer" />
        <div className="topbar-actions">
          <span
            className="topbar-badge"
            style={{
              background: `${config.brandColor}1a`,
              color: config.brandColor,
            }}
          >
            {config.brandSubtitle}
          </span>
        </div>
      </div>
      <main className="content" style={{ gridArea: "content" }}>
        {children}
      </main>
    </div>
  );
}
