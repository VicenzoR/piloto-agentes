export const metadata = { title: "Central de Comando - Piloto" };
export default function RootLayout({ children }) {
  return (
    <html lang="pt-BR">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif", background: "#f5f6f8", color: "#1b1f2a" }}>{children}</body>
    </html>
  );
}
