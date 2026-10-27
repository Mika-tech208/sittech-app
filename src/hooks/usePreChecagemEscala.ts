"use client";

// Navegador: 5 minutos antes de cada período, pede ao servidor a revalidação da disponibilidade das máquinas (mesmo endpoint
// idempotente de sempre: reconcilia Paradas, confere a invariante e drena a fila; sem mudança = nada acontece). A TV da fábrica e
// a tela da Escala são as telas que ficam abertas o dia todo — isto é redundância do evento imediato e dos agendadores no servidor,
// não a garantia única. Ao voltar de suspensão/aba em segundo plano (timers atrasados), dispara na hora e reagenda.

import { useEffect } from "react";
import { proximaPreChecagemMs } from "@/features/escala/preChecagem";
import { dispararProcessamentoEscala } from "@/lib/escala/disparar";

const FOLGA_MS = 2_000; // dispara logo DEPOIS do alvo (início − 5 min), nunca antes

export function usePreChecagemEscala(periodos: { inicio: string }[] | undefined): void {
  const chave = (periodos ?? []).map((p) => p.inicio.slice(0, 5)).sort().join(",");
  useEffect(() => {
    const lista = chave ? chave.split(",").map((inicio) => ({ inicio })) : [];
    if (lista.length === 0) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const agendar = () => {
      const alvo = proximaPreChecagemMs(Date.now(), lista);
      if (alvo === null) return;
      timer = setTimeout(() => { void dispararProcessamentoEscala(); agendar(); }, Math.max(1_000, alvo - Date.now()) + FOLGA_MS);
    };
    const aoVoltar = () => {
      if (document.visibilityState !== "visible") return;
      if (timer) clearTimeout(timer);
      void dispararProcessamentoEscala();
      agendar();
    };
    agendar();
    document.addEventListener("visibilitychange", aoVoltar);
    return () => { if (timer) clearTimeout(timer); document.removeEventListener("visibilitychange", aoVoltar); };
  }, [chave]);
}
