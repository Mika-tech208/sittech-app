/* eslint-disable @typescript-eslint/no-explicit-any */
// SOMENTE LEITURA. Monta o EstadoBruto da semana 2026-11-02 a partir dos .out dos SELECTs em PROD (espelha supabaseIO.carregarEstado).
import * as fs from "node:fs";
import * as path from "node:path";
import { lerParametros } from "@/features/escala/parametros";
import type { PeriodoEscala } from "@/features/escala/types";
import type { EstadoBruto } from "@/lib/escala/estado";

export const SQL_DIR = process.env.SQL_DIR ?? "/private/tmp/claude-501/-Users-mikaellonghi-Documents/46f8091f-a2ac-4875-a213-e5a3b744b594/scratchpad/pico/sql";
export function rows(nome: string): any[] {
  const t = fs.readFileSync(path.join(SQL_DIR, nome + ".sql.out"), "utf8");
  return JSON.parse(t.slice(t.indexOf("{"))).rows;
}
const hhmm = (t: string) => String(t).slice(0, 5);
const PERIODOS_META = ["m1", "m2", "m3", "t1", "t2", "t3"] as const;

export function montarEstado(): { estado: EstadoBruto; raw: Record<string, any[]> } {
  const raw: Record<string, any[]> = {};
  for (const n of ["q_prev", "q_dias", "q_equipe", "q_itens", "q_periodos", "q_nomes", "q_params", "q_etapas", "q_aus", "q_indisp", "q_indisp_prev", "q_inativas", "q_existentes"]) raw[n] = rows(n);
  const nomes = raw.q_nomes;
  const prev = raw.q_prev[0];
  const funcPorId = new Map(nomes.filter((x) => x.k === "func").map((x) => [x.id, x]));
  const equipe = raw.q_equipe.filter((r) => r.produtivo);
  const itens = raw.q_itens.filter((i) => i.tipo === "previsto").map((i) => {
    const porEtapa: Record<string, string[]> = {};
    i.maquinas.forEach((r: any) => (porEtapa[r.etapa_id] ||= []).push(r.maquina_id));
    const adic = i.adic as any[];
    return {
      produtoId: i.produto_id, quantidade: Number(i.quantidade), quantidadeAdicional: Number(i.quantidade_adicional ?? 0), valorUnitario: Number(i.valor_unitario), maquinasPorEtapa: porEtapa,
      ...(adic.length > 0 ? { adicionalPorEtapa: Object.fromEntries(adic.map((r) => [r.etapa_id, Number(r.quantidade)])) } : {}),
    };
  });
  const periodosAtuais: PeriodoEscala[] = raw.q_periodos.map((p) => ({ id: p.id, nome: p.nome, inicio: hhmm(p.inicio), fim: hhmm(p.fim) }));
  const estado: EstadoBruto = {
    previsaoId: prev.id,
    semanaInicio: prev.semana_inicio,
    diasProdutivos: raw.q_dias.filter((d) => d.ativo).map((d) => d.dia).sort(),
    periodosAtuais,
    diasExistentes: [],
    equipeProdutiva: equipe.map((r) => ({ funcionarioId: r.funcionario_id, nome: r.nome, ativo: funcPorId.get(r.funcionario_id)?.ativo === "true" })),
    itens,
    etapas: raw.q_etapas.map((e) => ({
      id: e.id, produtoId: e.produto_id, operacaoId: e.operacao_id, ordem: Number(e.ordem),
      metas: Object.fromEntries(PERIODOS_META.map((p) => [p, Number(e[`meta_${p}`] ?? 0)])), maquinasCompativeis: e.compat,
    })),
    maquinasIndisponiveisPrevisao: raw.q_indisp_prev.map((r) => r.maquina_id),
    maquinasInativas: raw.q_inativas.map((r) => r.id),
    ausencias: raw.q_aus.map((a) => ({ funcionarioId: a.funcionario_id, data: a.data, horarioInicio: a.horario_inicio, horarioFim: a.horario_fim, ...(a.em_aberto ? { emAberto: true } : {}) })),
    indisponibilidades: raw.q_indisp.map((i) => ({ maquinaId: i.maquina_id, desde: i.desde, liberadaEm: i.liberada_em })),
    alocacoes: [],
    nomesOperacao: Object.fromEntries(nomes.filter((x) => x.k === "op").map((x) => [x.id, x.nome])),
    nomesMaquinas: Object.fromEntries(nomes.filter((x) => x.k === "maq").map((x) => [x.id, x.nome])),
    operacaoDaMaquina: Object.fromEntries(nomes.filter((x) => x.k === "maq" && x.op).map((x) => [x.id, x.op])),
    nomesProdutos: Object.fromEntries(nomes.filter((x) => x.k === "prod").map((x) => [x.id, x.nome])),
    historicoEquidade: undefined, // só afeta QUEM ocupa o posto, não QUAIS postos são cobertos
    parametros: lerParametros(raw.q_params.map((r) => ({ chave: r.chave, valor: JSON.parse(r.valor) }))),
    proximaSemana: null, // semana 2026-11-09 sem Previsão salva
  };
  return { estado, raw };
}
