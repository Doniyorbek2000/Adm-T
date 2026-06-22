export default function GlobalNotFound() {
  return (
    <html lang="en">
      <body style={{ background: "#0f172a", color: "#e2e8f0", fontFamily: "system-ui, sans-serif" }}>
        <div style={{ display: "flex", minHeight: "100vh", alignItems: "center", justifyContent: "center" }}>
          <div style={{ maxWidth: 400, textAlign: "center" }}>
            <div style={{ fontSize: 72, fontWeight: 700, color: "#34d399", marginBottom: 16 }}>404</div>
            <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>Sahifa topilmadi</h1>
            <p style={{ color: "#94a3b8", marginBottom: 24 }}>
              Siz qidirayotgan sahifa mavjud emas.
            </p>
            <a
              href="/"
              style={{
                display: "inline-block",
                padding: "10px 24px",
                background: "#10b981",
                color: "#fff",
                borderRadius: 8,
                textDecoration: "none",
                fontWeight: 600,
              }}
            >
              Bosh sahifaga qaytish
            </a>
          </div>
        </div>
      </body>
    </html>
  );
}
