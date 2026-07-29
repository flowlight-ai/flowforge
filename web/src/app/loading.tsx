export default function Loading() {
  return (
    <div className="animate-rise">
      <div className="card">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "12px", marginTop: "20px" }}>
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} style={{ padding: "16px", borderRadius: "var(--radius-md)", background: "var(--bg-elevated)", border: "1px solid var(--border)" }}>
              <div style={{ width: "60px", height: "11px", borderRadius: "4px", background: "var(--bg-hover)", marginBottom: "4px" }} />
              <div style={{ width: "40px", height: "24px", borderRadius: "4px", background: "var(--bg-hover)", animation: "pulse 1.5s ease-in-out infinite" }} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
