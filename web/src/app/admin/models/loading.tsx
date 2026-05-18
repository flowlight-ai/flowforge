export default function Loading() {
  return (
    <div className="animate-rise">
      <div className="card">
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "8px 12px", borderRadius: "6px", background: "var(--bg-elevated)", border: "1px solid var(--border)" }}>
              <div style={{ width: "60px", height: "14px", borderRadius: "4px", background: "var(--bg-hover)" }} />
              <div style={{ flex: 1, height: "14px", borderRadius: "4px", background: "var(--bg-hover)" }} />
              <div style={{ width: "40px", height: "18px", borderRadius: "10px", background: "var(--bg-hover)" }} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
