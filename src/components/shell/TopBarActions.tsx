"use client";

import { Menu } from "lucide-react";
import IntelligenceTrigger from "@/features/intelligence/components/IntelligenceTrigger";
import { TRILHA_POR_ABA } from "@/lib/constants";

export interface TopBarActionsProps {
  modoPrivado: boolean;
  onToggleModoPrivado: () => void;
  tema: "dark" | "light";
  onToggleTema: () => void;
  usuarioLogado?: { papel: "admin" | "usuario"; permissoes?: string[] } | null;
  // Mesma chave já passada pro Sidebar (abaAtiva) — usada só pra resolver a
  // trilha de contexto "Grupo / Página" (§2 do handoff; ver TRILHA_POR_ABA
  // em src/lib/constants.ts). Não dispara nenhuma busca de dado novo.
  abaAtiva: string;
  // Só renderizado <768px — abre a gaveta da Sidebar (ver Sidebar.tsx).
  onAbrirMenu?: () => void;
}

// Topbar — redesign visual "Estúdio" (design_handoff_sittech_estudio, 4B).
// Não é mais uma barra de ferramentas: é uma linha de contexto (trilha
// "Grupo / Página") com o gatilho da Intelligence como único elemento com
// presença visual própria. "Minha conta"/"Sair" saíram daqui pro rodapé da
// Sidebar; o sino decorativo foi removido (nunca teve função — ver
// SITTECH_DESIGN_HANDOFF.md §22).
export default function TopBarActions({ modoPrivado, onToggleModoPrivado, tema, onToggleTema, usuarioLogado, abaAtiva, onAbrirMenu }: TopBarActionsProps) {
  const trilha = TRILHA_POR_ABA[abaAtiva];

  return (
    <div className="stx-topbar">
      {onAbrirMenu && (
        <button type="button" className="stx-topbar-menu-btn" onClick={onAbrirMenu} aria-label="Abrir menu">
          <Menu size={19} />
        </button>
      )}
      <div className="stx-topbar-trilha">
        {trilha?.grupo && (
          <>
            <span className="stx-topbar-trilha-grupo">{trilha.grupo}</span>
            <span className="stx-topbar-trilha-sep">/</span>
          </>
        )}
        <span className="stx-topbar-trilha-pagina">{trilha?.pagina || ""}</span>
      </div>
      <span className="stx-topbar-spacer" />
      <IntelligenceTrigger usuarioLogado={usuarioLogado ?? null} />
      <button type="button" className="stx-topbar-link" onClick={onToggleModoPrivado}>
        {modoPrivado ? "Mostrar valores" : "Ocultar valores"}
      </button>
      <button type="button" className="stx-topbar-link" onClick={onToggleTema}>
        {tema === "dark" ? "Tema claro" : "Tema escuro"}
      </button>
    </div>
  );
}
