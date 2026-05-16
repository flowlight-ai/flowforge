"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useShellConfig } from "../lib/shell-config";

export default function Sidebar() {
  const pathname = usePathname();
  const config = useShellConfig();

  const isActive = (href: string) => {
    if (href === "/") return pathname === "/";
    return pathname.startsWith(href);
  };

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <div
          className="sidebar-logo"
          style={{ background: config.brandColor }}
        >
          {config.brandShort}
        </div>
        <div>
          <div className="sidebar-title">{config.brandName}</div>
          <div className="sidebar-subtitle">
            {config.brandSubtitle} {config.version}
          </div>
        </div>
      </div>

      <nav className="sidebar-nav">
        {config.navSections.map((section) => (
          <div key={section.label} className="nav-section">
            <div className="nav-section-label">{section.label}</div>
            <div className="nav-items">
              {section.items.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`nav-item${isActive(item.href) ? " active" : ""}`}
                >
                  <span className="nav-item-icon">{item.icon}</span>
                  <span>{item.label}</span>
                  {item.badge != null && (
                    <span className="nav-item-badge">{item.badge}</span>
                  )}
                </Link>
              ))}
            </div>
          </div>
        ))}
      </nav>

      <div className="sidebar-footer">
        <div className="mode-switcher">
          <span className="mode-label">模式</span>
          <div className="mode-btns">
            <Link
              href="/"
              className={`mode-btn${!pathname.startsWith("/solo") ? " active" : ""}`}
            >
              普通
            </Link>
            <Link
              href="/solo"
              className={`mode-btn${pathname.startsWith("/solo") ? " active" : ""}`}
            >
              Solo
            </Link>
          </div>
        </div>
        <div className="version-row">
          <span className="version-label">版本</span>
          <span className="version-value">{config.version}</span>
        </div>
      </div>
    </div>
  );
}
