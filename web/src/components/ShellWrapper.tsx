"use client";

import { usePathname } from "next/navigation";
import { useShellConfig } from "../lib/shell-config";
import Sidebar from "./Sidebar";

export default function ShellWrapper({
  children,
  sidebar,
}: {
  children: React.ReactNode;
  sidebar?: React.ReactNode;
}) {
  const pathname = usePathname();
  const config = useShellConfig();
  const isSolo = (config.soloPaths ?? ["/solo"]).some((p) => pathname.startsWith(p));

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
      <header
        style={{
          gridArea: "nav",
          borderRight: "1px solid color-mix(in srgb, var(--border, #2e3040) 74%, transparent)",
          overflow: "hidden",
        }}
      >
        {sidebar ?? <Sidebar />}
      </header>
      <div
        style={{
          gridArea: "topbar",
          display: "flex",
          alignItems: "center",
          padding: "0 24px",
          borderBottom: "1px solid color-mix(in srgb, var(--border, #2e3040) 74%, transparent)",
          background: "color-mix(in srgb, var(--bg, #0e1015) 82%, transparent)",
          backdropFilter: "blur(12px) saturate(1.6)",
          WebkitBackdropFilter: "blur(12px) saturate(1.6)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
            fontSize: "14px",
            fontWeight: 700,
            color: config.brandColor,
            letterSpacing: "1px",
          }}
        >
          <span>{config.brandName}</span>
        </div>
        <div style={{ flex: 1 }} />
        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          <span
            style={{
              padding: "4px 10px",
              borderRadius: "9999px",
              background: `${config.brandColor}1a`,
              color: config.brandColor,
              fontSize: "11px",
              fontWeight: 600,
            }}
          >
            {config.brandSubtitle}
          </span>
        </div>
      </div>
      <main
        style={{
          gridArea: "content",
          padding: "24px",
          overflowY: "auto",
          overflowX: "hidden",
        }}
      >
        {children}
      </main>
    </div>
  );
}
