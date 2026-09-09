import type { Metadata, Viewport } from "next";
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
  // PWA "Adicionar à Tela de Início" (iOS) — modo standalone. Sem isso, o
  // Safari mesmo assim ignoraria display:"standalone" do manifest.ts pra
  // sites abertos via ícone da Tela de Início (o manifest é lido pelo
  // Android/Chrome; o iOS Safari usa especificamente estas meta tags
  // apple-mobile-web-app-*). "black-translucent" deixa a status bar
  // transparente sobre o conteúdo (mesmo tom escuro do app aparece atrás
  // dela) — por isso o CSS de safe-area em GlobalStyles.tsx (.stx-root)
  // é obrigatório, senão conteúdo ficaria embaixo da status bar/notch.
  appleWebApp: {
    capable: true,
    title: "Sittech",
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Ativa env(safe-area-inset-*) no CSS (sem isso, safe-area-inset-* fica
  // sempre 0, mesmo com o CSS já preparado em GlobalStyles.tsx) — junto
  // com statusBarStyle "black-translucent" acima, é o que faz o conteúdo
  // não ficar escondido atrás do notch/status bar/home indicator.
  viewportFit: "cover",
  // Mesmo tom do tema escuro padrão do app (THEMES.dark.bg) — cor da UI
  // do navegador/task-switcher quando NÃO está em modo standalone (em
  // standalone, quem manda na status bar é o appleWebApp.statusBarStyle
  // acima). Independente do toggle claro/escuro dentro do app — esse
  // toggle é client-side, não muda o prefers-color-scheme do SO.
  themeColor: "#1A1918",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="pt-BR" className={schibstedGrotesk.variable}>
      <head>
        {/* Next 16 (ver appleWebApp acima) só emite a meta tag padrão
            "mobile-web-app-capable" — não emite mais a legada
            "apple-mobile-web-app-capable", que iOS/Safari mais antigos
            (fora do alcance da API de metadata nativa) ainda exigem pra
            reconhecer o modo standalone. Único <meta> manual deste
            arquivo, mantido de propósito por essa lacuna específica. */}
        <meta name="apple-mobile-web-app-capable" content="yes" />
      </head>
      <body>{children}</body>
    </html>
  );
}
