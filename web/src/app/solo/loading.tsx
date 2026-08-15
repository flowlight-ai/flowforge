/**
 * solo/loading.tsx — /solo 路由加载骨架屏
 *
 * 在 HelmLayout 等动态组件（ssr:false）加载期间显示，
 * 模拟 HelmLayout 三栏布局（左任务列表 / 中聊天 / 右工作区），
 * 避免白屏闪烁，提升感知加载速度。
 *
 * 样式变量与 council/loading.tsx 保持一致，确保主题统一。
 */

export default function SoloLoading() {
  return (
    <div
      style={{
        display: "flex",
        height: "100dvh",
        width: "100vw",
        overflow: "hidden",
        background: "var(--bg)",
      }}
    >
      {/* 左栏骨架 — 任务列表（HelmLeftPanel） */}
      <div
        style={{
          width: "260px",
          flexShrink: 0,
          borderRight: "1px solid var(--border)",
          background: "var(--bg-elevated)",
          padding: "16px",
        }}
      >
        {/* 工作区选择器占位 */}
        <div
          style={{
            height: "32px",
            borderRadius: "var(--radius-sm)",
            background: "var(--bg-hover)",
            marginBottom: "12px",
          }}
        />
        {/* 任务列表项占位 */}
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            style={{
              height: "48px",
              borderRadius: "var(--radius-sm)",
              background: "var(--bg-hover)",
              marginBottom: "8px",
              opacity: 1 - i * 0.15,
            }}
          />
        ))}
      </div>

      {/* 中栏骨架 — 聊天区（HelmMainPanel） */}
      <div
        style={{
          flex: 1,
          padding: "16px",
          display: "flex",
          flexDirection: "column",
          minWidth: 0,
        }}
      >
        {/* 顶部工作区栏占位 */}
        <div
          style={{
            height: "56px",
            borderRadius: "var(--radius-md)",
            background: "var(--bg-hover)",
            marginBottom: "16px",
          }}
        />
        {/* 消息气泡占位（左右交替） */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "12px" }}>
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              style={{
                alignSelf: i % 2 === 0 ? "flex-start" : "flex-end",
                width: "60%",
                height: "72px",
                borderRadius: "var(--radius-md)",
                background: "var(--bg-hover)",
                opacity: 1 - i * 0.18,
              }}
            />
          ))}
        </div>
        {/* 输入框占位 */}
        <div
          style={{
            height: "48px",
            borderRadius: "var(--radius-md)",
            background: "var(--bg-hover)",
            marginTop: "16px",
          }}
        />
      </div>

      {/* 右栏骨架 — 编辑器/工作区（HelmRightPanel） */}
      <div
        style={{
          width: "360px",
          flexShrink: 0,
          borderLeft: "1px solid var(--border)",
          background: "var(--bg-elevated)",
          padding: "16px",
        }}
      >
        {/* 标签栏占位 */}
        <div
          style={{
            height: "32px",
            borderRadius: "var(--radius-sm)",
            background: "var(--bg-hover)",
            marginBottom: "12px",
          }}
        />
        {/* 编辑器内容区占位 */}
        <div
          style={{
            height: "200px",
            borderRadius: "var(--radius-sm)",
            background: "var(--bg-hover)",
          }}
        />
      </div>
    </div>
  );
}
