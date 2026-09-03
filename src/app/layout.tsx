import type { Metadata } from "next";
import "./globals.css";

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
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
