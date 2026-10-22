import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Loja do Ouro · Administração",
  description: "Visão privada de vendas, operação e marketing.",
  robots: { index: false, follow: false },
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-PT">
      <body>{children}</body>
    </html>
  );
}
