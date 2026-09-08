import type { Metadata } from "next";
import { Schibsted_Grotesk } from "next/font/google";
import "./globals.css";

// Redesign visual "Estúdio" — família única (ver design_handoff_sittech_estudio/README.md
// "Assets"). Carregada via next/font (self-hosted pelo Next, sem @import de
// Google Fonts no <style> injetado) — substitui Sora + Inter + JetBrains
// Mono em GlobalStyles.tsx. `variable` expõe uma CSS custom property que os
// três tokens de fonte (--font-display/--font-body/--font-mono) passam a
// referenciar, todos apontando pra mesma família agora.
const schibstedGrotesk = Schibsted_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-schibsted-grotesk",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Sittech — Gestão",
  description: "Sistema de custos, previsão e capacidade da Sittech",
  icons: {
    icon: "/sittech-icon-v2.png",
    apple: "/sittech-apple-icon-v2.png",
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="pt-BR" className={schibstedGrotesk.variable}>
      <body>{children}</body>
    </html>
  );
}
