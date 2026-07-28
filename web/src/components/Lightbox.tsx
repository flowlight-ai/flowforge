"use client";

/**
 * Lightbox — 图片预览
 *
 * 全屏遮罩展示放大图片；支持 ESC 关闭、点击空白关闭、上一张/下一张。
 * 移植自 clowder-ai Lightbox，简化为受控组件。
 */

import { useCallback, useEffect } from "react";

export interface LightboxImage {
  readonly src: string;
  readonly alt?: string;
  readonly caption?: string;
}

interface LightboxProps {
  readonly open: boolean;
  readonly images: ReadonlyArray<LightboxImage>;
  readonly index: number;
  readonly onIndexChange: (next: number) => void;
  readonly onClose: () => void;
}

export function Lightbox({ open, images, index, onIndexChange, onClose }: LightboxProps) {
  const next = useCallback(() => {
    if (images.length === 0) return;
    onIndexChange((index + 1) % images.length);
  }, [images.length, index, onIndexChange]);

  const prev = useCallback(() => {
    if (images.length === 0) return;
    onIndexChange((index - 1 + images.length) % images.length);
  }, [images.length, index, onIndexChange]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") next();
      else if (e.key === "ArrowLeft") prev();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, next, prev, onClose]);

  if (!open || images.length === 0) return null;

  const current = images[Math.min(index, images.length - 1)];

  return (
    <div
      data-lightbox="root"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "var(--scrim-heavy)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1200,
        padding: "20px",
      }}
    >
      <button
        data-lightbox-action="close"
        onClick={onClose}
        aria-label="关闭"
        style={{
          position: "absolute",
          top: 16,
          right: 16,
          background: "rgba(255,255,255,0.1)",
          border: "none",
          color: "#fff",
          fontSize: "20px",
          cursor: "pointer",
          padding: "8px 12px",
          borderRadius: "var(--radius-sm)",
        }}
      >
        ×
      </button>

      {images.length > 1 && (
        <>
          <button
            data-lightbox-action="prev"
            onClick={(e) => { e.stopPropagation(); prev(); }}
            aria-label="上一张"
            style={{
              position: "absolute",
              left: 16,
              top: "50%",
              transform: "translateY(-50%)",
              background: "rgba(255,255,255,0.1)",
              border: "none",
              color: "#fff",
              fontSize: "24px",
              cursor: "pointer",
              padding: "12px 16px",
              borderRadius: "var(--radius-sm)",
            }}
          >
            ‹
          </button>
          <button
            data-lightbox-action="next"
            onClick={(e) => { e.stopPropagation(); next(); }}
            aria-label="下一张"
            style={{
              position: "absolute",
              right: 16,
              top: "50%",
              transform: "translateY(-50%)",
              background: "rgba(255,255,255,0.1)",
              border: "none",
              color: "#fff",
              fontSize: "24px",
              cursor: "pointer",
              padding: "12px 16px",
              borderRadius: "var(--radius-sm)",
            }}
          >
            ›
          </button>
        </>
      )}

      <figure
        onClick={(e) => e.stopPropagation()}
        data-lightbox="figure"
        style={{
          margin: 0,
          maxWidth: "90vw",
          maxHeight: "85vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "8px",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={current.src}
          alt={current.alt ?? ""}
          data-lightbox="image"
          style={{
            maxWidth: "90vw",
            maxHeight: "75vh",
            objectFit: "contain",
            borderRadius: "var(--radius-sm)",
          }}
        />
        {current.caption && (
          <figcaption
            data-lightbox="caption"
            style={{ color: "rgba(255,255,255,0.85)", fontSize: "12px", textAlign: "center" }}
          >
            {current.caption}
            {images.length > 1 && <span style={{ marginLeft: "8px", opacity: 0.6 }}>· {index + 1}/{images.length}</span>}
          </figcaption>
        )}
      </figure>
    </div>
  );
}
