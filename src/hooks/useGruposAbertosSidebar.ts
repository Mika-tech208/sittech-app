"use client";

// Estado do accordion da sidebar — grupos mutuamente exclusivos (só um
// aberto por vez). Centralizado num único valor (`grupoAberto`), não em
// 5 booleans independentes — `GruposAbertos` (o shape que Sidebar.tsx já
// espera) é só DERIVADO desse valor único na hora de renderizar, nunca
// existe como estado próprio.
//
// Abre automaticamente o grupo dono da aba atual na PRIMEIRA renderização
// (montagem do componente — que é exatamente o que acontece em navegação
// direta por URL ou F5, já que cada página migrada monta do zero nesses
// casos, e o monólito legado sempre começa em "inicio"). Depois disso, só
// o clique no cabeçalho do grupo (toggleGrupo) muda o estado — trocar de
// aba clicando um item dentro do grupo já aberto não mexe nisso.

import { useState } from "react";
import type { GruposAbertos } from "@/components/shell/Sidebar";

type Grupo = keyof GruposAbertos;

const GRUPOS_FECHADOS: GruposAbertos = {
  gestao: false, financeiro: false, planejamento: false, producaoReal: false, administracao: false,
};

// Mesma lista de abas que Sidebar.tsx já usa em cada bloco de grupo (ver
// `abaAtiva === "..."` lá) — só invertida (aba -> grupo dono).
const GRUPO_POR_ABA: Record<string, Grupo> = {
  custos: "gestao",
  funcionarios: "gestao",
  produtos: "gestao",
  maquinas: "gestao",
  horaEmpresa: "gestao",
  faturamento: "financeiro",
  bi: "financeiro",
  previsao: "planejamento",
  capacidade: "planejamento",
  producaoRealPainel: "producaoReal",
  producaoRealApontamentos: "producaoReal",
  prVisaoGeral: "producaoReal",
  prProdutividade: "producaoReal",
  prFuncionarios: "producaoReal",
  prDesvios: "producaoReal",
  prParadas: "producaoReal",
  prValidacao: "producaoReal",
  prDadosImportados: "producaoReal",
  usuarios: "administracao",
  importar: "administracao",
};

export function useGruposAbertosSidebar(abaAtiva: string) {
  const [grupoAberto, setGrupoAberto] = useState<Grupo | null>(() => GRUPO_POR_ABA[abaAtiva] ?? null);

  const gruposAbertos: GruposAbertos = grupoAberto ? { ...GRUPOS_FECHADOS, [grupoAberto]: true } : GRUPOS_FECHADOS;

  function toggleGrupo(grupo: Grupo) {
    setGrupoAberto((prev) => (prev === grupo ? null : grupo));
  }

  return { gruposAbertos, toggleGrupo };
}
