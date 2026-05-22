import type { Metadata } from "next";
import "./globals.css";
import Sidebar from "./components/Sidebar";

export const metadata: Metadata = {
  title: "Knot — News Intelligence",
  description: "Advanced News Clustering and Analysis Dashboard",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru">
      <body>
        <div style={{ display: 'flex' }}>
          <Sidebar />
          <main style={{
            marginLeft: '260px',
            width: 'calc(100% - 260px)',
            minHeight: '100vh',
            padding: '40px'
          }}>
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
