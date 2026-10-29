import type { Metadata } from "next";
import { cookies } from "next/headers";
import { MENU_COLLAPSED, MENU_COOKIE, menuCollapsed } from "@/lib/menu";
import "./globals.css";
export const metadata: Metadata = {
  title: "Loja do Ouro · Administração",
  description: "Visão privada de vendas, operação e marketing.",
  robots: { index: false, follow: false },
};
// Menu lateral recolhido (computador): vem do cookie, aqui no layout, que não volta a desenhar ao navegar entre
// páginas; a página chega já com o menu certo, sem saltar. As páginas do painel já são todas dinâmicas (sessão).
export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const collapsed = menuCollapsed((await cookies()).get(MENU_COOKIE)?.value);
  return (
    <html lang="pt-PT" data-menu={collapsed ? MENU_COLLAPSED : undefined}>
      <body>{children}</body>
    </html>
  );
}
