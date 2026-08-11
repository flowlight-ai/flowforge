/**
 * council/loading.tsx — 群聊路由加载骨架屏
 *
 * 在 CouncilChatPanel 等动态组件加载期间显示，
 * 避免白屏闪烁，提升感知加载速度
 */

export default function CouncilLoading() {
  return (
    <div
      style={{
        display: "flex",
        height: "100dvh",
        overflow: "hidden",
        background: "var(--bg)",
      }}
    >
      {/* 左栏骨架 */}
      <div
        style={{
          width: "240px",
          flexShrink: 0,
          borderRight: "1px solid var(--border)",
          background: "var(--bg-elevated)",
          padding: "12px",
        }}
      >
        <div
          style={{
            height: "28px",
            borderRadius: "var(--radius-sm)",
            background: "var(--bg-hover)",
            marginBottom: "12px",
          }}
        />
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            style={{
              height: "36px",
              borderRadius: "var(--radius-sm)",
              background: "var(--bg-hover)",
              marginBottom: "6px",
              opacity: 1 - i * 0.12,
            }}
          />
        ))}
      </div>

      {/* 中栏骨架 */}
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          padding: "16px",
        }}
      >
        <div
          style={{
            height: "52px",
            borderBottom: "1px solid var(--border)",
            marginBottom: "16px",
            display: "flex",
            alignItems: "center",
            gap: "12px",
          }}
        >
          <div style={{ width: "80px", height: "20px", borderRadius: "4px", background: "var(--bg-hover)" }} />
          <div style={{ flex: 1, height: "20px", borderRadius: "4px", background: "var(--bg-hover)" }} />
        </div>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "12px" }}>
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              style={{
                height: "60px",
                borderRadius: "var(--radius-md)",
                background: "var(--bg-hover)",
                opacity: 1 - i * 0.15,
              }}
            />
          ))}
        </div>
      </div>

      {/* 右栏骨架 */}
      <div
        style={{
          width: "360px",
          flexShrink: 0,
          borderLeft: "1px solid var(--border)",
          background: "var(--bg-elevated)",
          padding: "12px",
        }}
      >
        <div
          style={{
            height: "32px",
            borderRadius: "var(--radius-sm)",
            background: "var(--bg-hover)",
            marginBottom: "12px",
          }}
        />
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            style={{
              height: "40px",
              borderRadius: "var(--radius-sm)",
              background: "var(--bg-hover)",
              marginBottom: "6px",
              opacity: 1 - i * 0.12,
            }}
          />
        ))}
      </div>
    </div>
  );
}
