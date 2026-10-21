"use client";

// Hook do tema GLOBAL (ver src/lib/tema.ts). Todas as páginas usam este mesmo store de módulo, então trocar de rota,
// voltar, atualizar ou reabrir o app mantém a preferência salva em localStorage ("sittech-theme").

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { criarStoreTema, TEMA_PADRAO, type Tema } from "@/lib/tema";

const armazenamentoDoNavegador = () => (typeof window === "undefined" ? null : (() => { try { return window.localStorage; } catch { return null; } })());

let store: ReturnType<typeof criarStoreTema> | null = null;
function obterStore() {
  if (!store) {
    store = criarStoreTema(armazenamentoDoNavegador());
    if (typeof window !== "undefined") window.addEventListener("storage", () => store?.sincronizar()); // outra aba mudou o tema
  }
  return store;
}

export function useTema(): [Tema, (proximo: Tema | ((atual: Tema) => Tema)) => void] {
  const tema = useSyncExternalStore(
    (ouvinte) => obterStore().assinar(ouvinte),
    () => obterStore().obter(),
    () => TEMA_PADRAO // servidor e 1ª hidratação: padrão; o cliente corrige em seguida (o CSS esconde o intervalo, ver globals.css)
  );
  const definir = useCallback((proximo: Tema | ((atual: Tema) => Tema)) => obterStore().definir(proximo), []);
  useEffect(() => {
    const html = document.documentElement;
    html.setAttribute("data-tema", tema);
    // só revela depois de o React ter renderizado com o tema salvo (evita o flash do tema errado)
    if (tema === obterStore().obter()) html.setAttribute("data-tema-pronto", "1");
  }, [tema]);
  return [tema, definir];
}
