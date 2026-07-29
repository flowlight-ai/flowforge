"use client";

import { useCallback, useEffect, useRef } from "react";

interface ResizeHandleProps {
  direction: "horizontal" | "vertical";
  label?: string;
  onResize: (delta: number) => void;
  onCollapse?: () => void;
  onDoubleClick?: () => void;
  showLine?: boolean;
}

export function ResizeHandle({
  direction,
  label,
  onResize,
  onCollapse,
  onDoubleClick,
  showLine = true,
}: ResizeHandleProps) {
  const draggingRef = useRef(false);
  const lastPosRef = useRef(0);

  const isHorizontal = direction === "horizontal";

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      draggingRef.current = true;
      lastPosRef.current = isHorizontal ? e.clientX : e.clientY;
      document.body.style.cursor = isHorizontal ? "col-resize" : "row-resize";
      document.body.style.userSelect = "none";
    },
    [isHorizontal],
  );

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!draggingRef.current) return;
      const current = isHorizontal ? e.clientX : e.clientY;
      const delta = current - lastPosRef.current;
      lastPosRef.current = current;
      onResize(delta);
    };
    const handleMouseUp = () => {
      if (draggingRef.current) {
        draggingRef.current = false;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      }
    };
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isHorizontal, onResize]);

  return (
    <div
      role="separator"
      aria-orientation={isHorizontal ? "vertical" : "horizontal"}
      aria-label={label}
      onMouseDown={handleMouseDown}
      onDoubleClick={onCollapse ?? onDoubleClick}
      data-resize-handle={direction}
      style={{
        width: isHorizontal ? "4px" : "100%",
        height: isHorizontal ? "100%" : "4px",
        cursor: isHorizontal ? "col-resize" : "row-resize",
        background: showLine ? "var(--console-border-soft, transparent)" : "transparent",
        flexShrink: 0,
        transition: "background 0.15s ease",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "var(--cafe-accent, #ff5c5c)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = showLine
          ? "var(--console-border-soft, transparent)"
          : "transparent";
      }}
    />
  );
}
