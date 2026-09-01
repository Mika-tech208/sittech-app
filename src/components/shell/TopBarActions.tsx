"use client";

import { Bell } from "lucide-react";

export interface TopBarActionsProps {
  modoPrivado: boolean;
  onToggleModoPrivado: () => void;
  tema: "dark" | "light";
  onToggleTema: () => void;
  onAbrirMinhaConta: () => void;
  onSair: () => void;
}

// Botões do canto superior direito (Ocultar valores / Modo claro-escuro /
// Minha conta / Sair / sino) — idênticos em toda tela autenticada, extraído
// pra não duplicar entre o app legado e as novas rotas.
export default function TopBarActions({ modoPrivado, onToggleModoPrivado, tema, onToggleTema, onAbrirMinhaConta, onSair }: TopBarActionsProps) {
  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
      <button
        className="stx-theme-toggle"
        style={modoPrivado ? { background: "var(--warning)", color: "#1a1500", borderColor: "var(--warning)" } : undefined}
        onClick={onToggleModoPrivado}
        title="Oculta valores em R$ na tela — útil quando outra pessoa está olhando junto"
      >
        {modoPrivado ? "🙈 Modo privado ligado" : "👁 Ocultar valores"}
      </button>
      <button className="stx-theme-toggle" onClick={onToggleTema}>
        {tema === "dark" ? "☀ Modo claro" : "🌙 Modo escuro"}
      </button>
      <button className="stx-theme-toggle" onClick={onAbrirMinhaConta}>👤 Minha conta</button>
      <button className="stx-theme-toggle" onClick={onSair}>Sair</button>
      <span className="stx-bell-wrap" title="Notificações">
        <Bell size={18} />
        <span className="stx-bell-dot" />
      </span>
    </div>
  );
}
