import type { MetadataRoute } from "next";

// PWA "Adicionar à Tela de Início" (iOS) — modo standalone, sem barra de
// endereço/Safari. background_color/theme_color usam o mesmo tom do tema
// escuro padrão do app (THEMES.dark.bg em src/lib/constants.ts, também
// hardcoded como fallback pré-hidratação em globals.css) — nenhuma cor
// nova inventada aqui. Ícones reaproveitam os já usados em
// metadata.icons (src/app/layout.tsx); o de 192x192 é um resize do
// 512x512 existente (sittech-icon-v2.png), gerado via sips — nenhuma arte
// nova.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Sittech",
    short_name: "Sittech",
    description: "Sistema de custos, previsão e capacidade da Sittech",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#1A1918",
    theme_color: "#1A1918",
    icons: [
      {
        src: "/sittech-icon-192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/sittech-icon-v2.png",
        sizes: "512x512",
        type: "image/png",
      },
    ],
  };
}
