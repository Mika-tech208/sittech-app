"use client";

// Estado de shell da sidebar (redesign "Estúdio" — ver
// design_handoff_sittech_estudio/README.md, "Interactions & Behavior" e
// "State Management"). Substitui useGruposAbertosSidebar.ts: mesmo
// contrato de entrada (abaAtiva) e mesma ideia de "abrir o grupo dono da
// aba atual na montagem", mas com duas mudanças de comportamento
// explicitamente autorizadas nesta etapa:
//   1) Acordeão agora é INDEPENDENTE — abrir um grupo não fecha os outros
//      (antes era um único `grupoAberto` mutuamente exclusivo).
//   2) Acrescenta `recolhida` (rail de 72px, lembrada por dispositivo via
//      localStorage) e `gavetaAberta` (drawer mobile, nunca persistida —
//      sempre começa fechada).
// Nenhum estado de domínio/dado é tocado aqui — só UI do shell.

import { useEffect, useState } from "react";
import type { GruposAbertos } from "@/components/shell/Sidebar";

type Grupo = keyof GruposAbertos;

const TODOS_FECHADOS: GruposAbertos = {
  gestao: false, financeiro: false, planejamento: false, producaoReal: false, administracao: false,
};

// Mesma lista de abas que Sidebar.tsx usa em cada bloco de grupo — só
// invertida (aba -> grupo dono). Idêntica à do hook anterior.
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
  prIndicadores: "producaoReal",
  prFuncionarios: "producaoReal",
  prDesvios: "producaoReal",
  prParadas: "producaoReal",
  prValidacao: "producaoReal",
  prDadosImportados: "producaoReal",
  usuarios: "administracao",
  importar: "administracao",
};

const CHAVE_RECOLHIDA = "sittech_sidebar_recolhida";

function lerRecolhidaPersistida(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(CHAVE_RECOLHIDA) === "1";
  } catch {
    return false;
  }
}

export function useSidebarState(abaAtiva: string) {
  const [gruposAbertosSet, setGruposAbertosSet] = useState<Set<Grupo>>(() => {
    const dono = GRUPO_POR_ABA[abaAtiva];
    return dono ? new Set([dono]) : new Set();
  });
  const [recolhida, setRecolhida] = useState(false);
  const [gavetaAberta, setGavetaAberta] = useState(false);
  // Tablet (768–1023px) tem seu PRÓPRIO padrão — recolhida ao entrar,
  // independente da preferência salva de desktop (ver README, "Sidebar
  // recolhível": "recolhida por padrão" no tablet; "Apontamento em tablet
  // já entra recolhida"). Não persiste: cada carregamento no tablet volta
  // a começar recolhida, o toggle nessa faixa só vale pra sessão atual.
  const emFaixaTablet = typeof window !== "undefined" && window.matchMedia("(min-width: 768px) and (max-width: 1023px)").matches;

  // Lido só no cliente (pós-montagem) pra nunca divergir do HTML do
  // primeiro render em SSR/hidratação.
  useEffect(() => {
    if (window.matchMedia("(min-width: 768px) and (max-width: 1023px)").matches) {
      setRecolhida(true);
      return;
    }
    setRecolhida(lerRecolhidaPersistida());
  }, []);

  function toggleGrupo(grupo: Grupo) {
    setGruposAbertosSet((prev) => {
      const next = new Set(prev);
      if (next.has(grupo)) next.delete(grupo);
      else next.add(grupo);
      return next;
    });
  }

  function toggleRecolhida() {
    setRecolhida((prev) => {
      const next = !prev;
      if (emFaixaTablet) return next; // sessão atual só — nunca grava no tablet.
      try {
        window.localStorage.setItem(CHAVE_RECOLHIDA, next ? "1" : "0");
      } catch {
        // localStorage indisponível (modo privado etc.) — só não persiste.
      }
      return next;
    });
  }

  const gruposAbertos: GruposAbertos = { ...TODOS_FECHADOS };
  gruposAbertosSet.forEach((g) => { gruposAbertos[g] = true; });

  return {
    gruposAbertos,
    toggleGrupo,
    recolhida,
    toggleRecolhida,
    gavetaAberta,
    abrirGaveta: () => setGavetaAberta(true),
    fecharGaveta: () => setGavetaAberta(false),
  };
}

export type SidebarState = ReturnType<typeof useSidebarState>;
