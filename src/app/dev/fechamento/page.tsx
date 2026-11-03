"use client";

// Fechamento físico — harness de DEV da tela do tablet (sem banco, sem login): intercepta fetch('/api/escala/fechamento/*') com cenários scriptados para
// revisar a UX e tirar screenshots. NÃO é uma tela de produção: em produção esta página nunca renderiza (notFound()), mesmo padrão de /dev/intelligence.
// Cenários (?cenario=): form (padrão) · pendentes · diferenca (2º passo) · erro (motor falha → retry confirma) · bloqueado (outro usuário)

import { notFound } from "next/navigation";
import { useState } from "react";
import GlobalStyles from "@/components/shell/GlobalStyles";
import { THEMES } from "@/lib/constants";
import { useTema } from "@/hooks/useTema";
import FechamentoPeriodoModal from "@/features/producao-real/fechamento/FechamentoPeriodoModal";

if (process.env.NODE_ENV === "production") {
  notFound();
}

const POSTOS = ["Rosqueadeira 3", "Rosqueadeira 6", "Rosqueadeira 7", "Parafusadeira 9", "Parafusadeira 10", "Parafusadeira 12", "M8 8", "Etiquetadora 15", "Etiquetadora 16", "Montagem 14 (Plug)", "Montagem 18"];
const BUFFERS = [
  { buffer_id: "b1", rotulo: "Rosqueadas aguardando Parafusar", estimado: 1900, estimado_lo: 1900, estimado_hi: 1900 },
  { buffer_id: "b2", rotulo: "Parafusadas aguardando Etiquetar", estimado: 7122, estimado_lo: 7122, estimado_hi: 7122 },
  { buffer_id: "b3", rotulo: "Etiquetadas aguardando Embalar", estimado: 8600, estimado_lo: 8600, estimado_hi: 8600 },
];
const PROG = [
  { maquina: "Etiquetadora 15", pessoa: "Rosa", produto: "Conector 3/4\"", pecas: 3000 }, { maquina: "Etiquetadora 16", pessoa: "Karelis", produto: "Caixa Amarela", pecas: 2269 },
  { maquina: "M8 8", pessoa: "Kelly", produto: "Conector 3/4\" Auto", pecas: 1100 }, { maquina: "Parafusadeira 10", pessoa: "Samantha", produto: "Conector 3/4\"", pecas: 1200 },
  { maquina: "Rosqueadeira 3", pessoa: "Caroline", produto: "Conector 3/4\"", pecas: 1547 }, { maquina: "Rosqueadeira 6", pessoa: "Elizabeth", produto: "Conector 3/4\"", pecas: 1546 },
];
const json = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status, headers: { "Content-Type": "application/json" } });
const tempos = { gravacao: 38, entrada: 910, corte: 2480, validacao: 24, persistencia: 410, total: 3862 };

function instalarMock(cenario: string) {
  const original = window.fetch;
  let tentativas = 0;
  window.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!url.includes("/api/escala/fechamento/")) return original(input, init);
    await new Promise((r) => setTimeout(r, 350));
    const corpo = init?.body ? JSON.parse(String(init.body)) : {};
    if (url.includes("/abrir")) {
      if (cenario === "bloqueado") return json({ erro: "Outro usuário já abriu o fechamento deste período (Supervisora B)." }, 409);
      const pend = cenario === "pendentes" ? [1, 4] : [];
      return json({ ok: true, abertura_id: "ab1", valido_ate_ms: Date.now() + 1_800_000, periodo: { data: "2026-11-03", periodo_id: "m2", rotulo: "M2", fim_ms: Date.now(), proximo: { rotulo: "M3", periodo_id: "m3" } },
        postos: POSTOS.map((nome, i) => ({ maquinaId: `m${i}`, nome, status: pend.includes(i) ? "pendente" : "produzindo", produzido: 1000, refugo: 0, motivo: null })), tem_pendentes: pend.length > 0, buffers: BUFFERS, pode_excecao: true });
    }
    if (url.includes("/estado")) return json({ modo: "ativo", fechado: false, estado: cenario === "erro" && tentativas > 0 ? "RECALCULANDO" : undefined });
    if (url.includes("/retry")) { await new Promise((r) => setTimeout(r, 1200)); return json({ ok: true, estado: "CONFIRMADO", fechamentoId: "f1", mensagem: "M3 CONFIRMADO", erros: [], exigeConfirmacao: [], tempos, proximo: { data: "2026-11-03", periodoId: "m3", rotulo: "M3" }, programacao: PROG }); }
    if (url.includes("/confirmar")) {
      tentativas++;
      await new Promise((r) => setTimeout(r, 1500));
      const grande = (corpo.buffers as { buffer_id: string; fisico: number }[]).some((b) => b.buffer_id === "b2" && b.fisico < 3500);
      if (cenario === "diferenca" && !corpo.confirmou_diferenca_grande && grande) return json({ ok: false, estado: null, fechamentoId: null, erros: [{ codigo: "CONFIRMACAO_DIFERENCA_GRANDE", mensagem: "Há diferença superior a 50% do estimado: confirme os valores." }], exigeConfirmacao: ["b2"], mensagem: "confirme" }, 422);
      if (cenario === "erro") return json({ ok: false, estado: "ERRO_RECALCULO", fechamentoId: "f1", mensagem: "Estoque salvo. Programação ainda não gerada.", erros: [{ codigo: "RECALCULO_FALHOU", mensagem: "planejador lançou: orçamento de tempo estourado" }], exigeConfirmacao: [], tempos }, 502);
      return json({ ok: true, estado: "CONFIRMADO", fechamentoId: "f1", mensagem: "M3 CONFIRMADO", erros: [], exigeConfirmacao: [], tempos, proximo: { data: "2026-11-03", periodoId: "m3", rotulo: "M3" }, programacao: PROG });
    }
    return original(input, init);
  };
  return () => { window.fetch = original; };
}

// o mock precisa existir ANTES de qualquer efeito do modal: instalado quando o módulo carrega no navegador (harness de DEV; fetch real nunca é usado aqui)
if (typeof window !== "undefined") instalarMock(new URLSearchParams(window.location.search).get("cenario") ?? "form");

function Harness() {
  const cenario = typeof window === "undefined" ? "form" : (new URLSearchParams(window.location.search).get("cenario") ?? "form");
  const [tema] = useTema();
  const [aberto, setAberto] = useState(true);
  const pronto = true;
  return (
    <div className="stx-root">
      <GlobalStyles cores={THEMES[tema]} />
      <div style={{ padding: 24 }}>
        <p>Harness de DEV · cenário <b suppressHydrationWarning>{cenario}</b> (form · pendentes · diferenca · erro · bloqueado)</p>
        {!aberto && <button type="button" className="stx-ap-btn-primary" onClick={() => setAberto(true)}>Reabrir</button>}
      </div>
      {pronto && aberto && <FechamentoPeriodoModal key={cenario} data="2026-11-03" periodoId="m2" onFechar={() => setAberto(false)} />}
    </div>
  );
}

export default function Page() {
  return <Harness />;
}
