import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Sittech — Custos e Produção",
  description: "Sistema de custos, previsão e capacidade da Sittech",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
