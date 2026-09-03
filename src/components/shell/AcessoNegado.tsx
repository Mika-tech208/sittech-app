"use client";

// Bloqueio real de rota — não é só o Sidebar escondendo o link. Renderizada
// no lugar do conteúdo da página quando o usuário autenticado não tem a
// permissão do módulo daquela URL (mesmo entrando direto pelo endereço).
// A proteção de verdade é a RLS (migration 20260902190000); esta tela é só
// a mensagem — os dados sensíveis já vêm vazios/bloqueados do backend
// independente dela.

export default function AcessoNegado() {
  return (
    <div className="stx-content-wrapper">
      <div className="stx-panel" style={{ maxWidth: 480, margin: "60px auto", textAlign: "center" }}>
        <p className="stx-panel-title">Acesso restrito</p>
        <p className="stx-panel-sub">Você não tem permissão para acessar esta área.</p>
      </div>
    </div>
  );
}
