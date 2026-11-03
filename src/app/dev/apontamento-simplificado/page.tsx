"use client";

// Apontamento simplificado — harness de DEV (sem banco, sem login): intercepta fetch('/api/escala/fechamento/*') com dados scriptados para revisar a UX e tirar screenshots.
// NÃO é tela de produção: em produção nunca renderiza (notFound()), mesmo padrão de /dev/fechamento. Cenários (?cenario=): ativo (padrão) · desligado · salvo · erro

import { notFound } from "next/navigation";
import { useState } from "react";
import GlobalStyles from "@/components/shell/GlobalStyles";
import { THEMES } from "@/lib/constants";
import { useTema } from "@/hooks/useTema";
import FechamentoPeriodoModal from "@/features/producao-real/fechamento/FechamentoPeriodoModal";

if (process.env.NODE_ENV === "production") {
  notFound();
}

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const MAQ = [["Rosqueadeira 3", "Caroline Souza", "Conector 3/4\"", "Rosquear", 1547], ["Rosqueadeira 6", "Elizabeth Lima", "Conector 3/4\"", "Rosquear", 1546], ["Parafusadeira 10", "Samantha Reis", "Conector 3/4\"", "Parafusar", 1200], ["Etiquetadora 15", "Rosa Pinto", "Conector 3/4\"", "Etiquetar", 3000], ["M8 8", "Kelly Dias", "Conector Auto", "Montar", 1100]] as const;
const json = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status, headers: { "Content-Type": "application/json" } });

function instalarMock(cenario: string) {
  const original = window.fetch;
  let salvo = false;
  let linhasSalvas: { maquina_id: string; nao_produziu: boolean; maquina_planejada_id: string | null }[] = [];
  const estado = () => ({
    modo: cenario === "desligado" ? "desligado" : "ativo",
    postos: MAQ.map((m, i) => ({ maquinaId: id(i + 1), maquinaNome: m[0], funcionarioId: id(100 + i), funcionarioNome: m[1], produtoId: id(200 + (i === 4 ? 1 : 0)), produtoNome: m[2], etapaId: id(300 + i), operacaoId: id(400 + i), operacaoNome: m[3], pecas: m[4] })),
    catalogo: {
      maquinas: [...MAQ.map((m, i) => ({ id: id(i + 1), nome: m[0] })), { id: id(9), nome: "Rosqueadeira 4" }],
      funcionarios: MAQ.map((m, i) => ({ id: id(100 + i), nome: m[1] })),
      produtos: [{ id: id(200), nome: "Conector 3/4\"" }, { id: id(201), nome: "Conector Auto" }],
      operacoes: Object.fromEntries(MAQ.map((m, i) => [id(400 + i), m[3]])),
      elegibilidade: [...MAQ.map((_, i) => ({ maquinaId: id(i + 1), produtoId: id(200 + (i === 4 ? 1 : 0)), etapaId: id(300 + i), operacaoId: id(400 + i) })), { maquinaId: id(9), produtoId: id(200), etapaId: id(300), operacaoId: id(400) }],
    },
    existentes: salvo ? linhasSalvas.map((l) => ({ id: `maq:${l.maquina_id}`, maquinaId: l.maquina_id, funcionarioId: l.nao_produziu ? null : id(100), produtoId: l.nao_produziu ? null : id(200), operacaoId: null, produzido: l.nao_produziu ? 0 : 1000, refugo: 0, status: l.nao_produziu ? "sem_producao" : "produzindo", motivoSemProducao: l.nao_produziu ? "falta_material" : null, descricaoSemProducao: null })) : [],
    vinculos: salvo ? linhasSalvas.map((l, i) => ({ apontamentoId: `maq:${l.maquina_id}`, origem: l.maquina_planejada_id ? "PROGRAMADO" : "POSTO_NAO_PLANEJADO", maquinaPlanejadaId: l.maquina_planejada_id, divergencias: [], naoProduziu: l.nao_produziu, motivo: l.nao_produziu ? "SEM_MATERIAL" : null, linhaChave: id(900 + i), descricaoInformada: "" })) : [],
  });
  window.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!url.includes("/api/escala/fechamento/")) return original(input, init);
    await new Promise((r) => setTimeout(r, 250));
    if (url.includes("/apontamentos")) {
      if (init?.method === "POST") {
        if (cenario === "erro") return json({ erro: "LINHA[x]: Meta não cadastrada (ou igual a zero) para este produto/operação no período m2", mensagem: "Nada foi gravado." }, 422);
        linhasSalvas = (JSON.parse(String(init.body)) as { linhas: typeof linhasSalvas }).linhas; salvo = true;
        return json({ ok: true, substituidas: 0, linhas: [] });
      }
      return json(estado());
    }
    if (url.includes("/abrir")) {
      const pend = MAQ.length - (salvo ? linhasSalvas.length : 0);
      return json({ ok: true, abertura_id: "ab1", valido_ate_ms: Date.now() + 1_800_000, periodo: { data: "2026-11-03", periodo_id: "m2", rotulo: "M2", fim_ms: Date.now(), proximo: { rotulo: "M3", periodo_id: "m3" } },
        postos: MAQ.map((m, i) => ({ maquinaId: id(i + 1), nome: m[0], status: salvo && linhasSalvas.some((l) => l.maquina_planejada_id === id(i + 1)) ? "produzindo" : "pendente", produzido: 0, refugo: 0, motivo: null })), tem_pendentes: pend > 0,
        buffers: [{ buffer_id: "b1", rotulo: "Rosqueadas aguardando Parafusar", estimado: 1900, estimado_lo: 1900, estimado_hi: 1900 }, { buffer_id: "b2", rotulo: "Parafusadas aguardando Etiquetar", estimado: 7122, estimado_lo: 7122, estimado_hi: 7122 }], pode_excecao: false, pares_sem_buffer: [], alertas: [] });
    }
    if (url.includes("/estado")) return json({ modo: "ativo", fechado: false });
    if (url.includes("/confirmar")) {
      await new Promise((r) => setTimeout(r, 1200));
      return json({ ok: true, estado: "CONFIRMADO", fechamentoId: "f1", mensagem: "M3 CONFIRMADO", erros: [], exigeConfirmacao: [], tempos: { gravacao: 38, entrada: 910, corte: 2480, validacao: 24, persistencia: 410, total: 3862 }, proximo: { data: "2026-11-03", periodoId: "m3", rotulo: "M3" },
        programacao: [{ maquina: "Etiquetadora 15", pessoa: "Rosa", produto: "Conector 3/4\"", pecas: 3000 }, { maquina: "Rosqueadeira 3", pessoa: "Caroline", produto: "Conector 3/4\"", pecas: 1547 }] });
    }
    return original(input, init);
  };
}
if (typeof window !== "undefined") instalarMock(new URLSearchParams(window.location.search).get("cenario") ?? "ativo");

function Harness() {
  const cenario = typeof window === "undefined" ? "ativo" : (new URLSearchParams(window.location.search).get("cenario") ?? "ativo");
  const [tema] = useTema();
  const [aberto, setAberto] = useState(true);
  return (
    <div className="stx-root">
      <GlobalStyles cores={THEMES[tema]} />
      <div style={{ padding: 24 }}>
        <p>Harness de DEV · apontamento simplificado · cenário <b suppressHydrationWarning>{cenario}</b> (ativo · desligado · erro)</p>
        {!aberto && <button type="button" className="stx-ap-btn-primary" onClick={() => setAberto(true)}>Reabrir</button>}
      </div>
      {aberto && <FechamentoPeriodoModal key={cenario} data="2026-11-03" periodoId="m2" onFechar={() => setAberto(false)} />}
    </div>
  );
}

export default function Page() { return <Harness />; }
