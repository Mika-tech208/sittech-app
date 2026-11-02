/* eslint-disable @typescript-eslint/no-explicit-any */
// FRENTE D — utilitários OFFLINE (nada é gravado): carrega o plano ATIVO de PROD (dump SELECT), simula um plano contra estoques iniciais (lote de 1 período, mesmo_periodo=false) e resume planos.
import * as fs from "node:fs";
import { expandirPorProduto, lerDistribuicao } from "@/features/escala/distribuicao";
import type { AlocacaoEscala, EntradaEscala } from "@/features/escala/types";
import { chavePool } from "@/features/escala/types";

export const D12 = "/private/tmp/claude-501/-Users-mikaellonghi-Documents/46f8091f-a2ac-4875-a213-e5a3b744b594/scratchpad/auditoria-1030/D12";

export function lerDump(dir: string, nome: string): any[] {
  const t = fs.readFileSync(`${dir}/${nome}.sql.out`, "utf8");
  return JSON.parse(t.slice(t.indexOf("{"))).rows;
}

export function carregarPlanoAtivo(dir: string): AlocacaoEscala[] {
  return lerDump(dir, "q_plano_ativo").map((r: any) => ({
    data: r.data, periodoId: r.periodo_id, funcionarioId: r.funcionario_id, maquinaId: r.maquina_id, produtoId: r.produto_id, etapaId: r.etapa_id, operacaoId: r.operacao_id,
    pecas: Number(r.pecas), pecasAdicional: Number(r.pecas_adicional ?? 0), motivoSemPosto: r.motivo_sem_posto, excecaoRevezamento: false, motivoExcecao: null, origem: r.origem === "manual" ? "manual" : "auto",
    ...(lerDistribuicao(r.distribuicao) ? { distribuicao: lerDistribuicao(r.distribuicao) } : {}),
  })) as AlocacaoEscala[];
}

export interface Cadeia { produtoId: string; etapas: { etapaId: string; operacaoId: string; ordem: number }[] }
export function cadeiasDe(entrada: EntradaEscala): Cadeia[] {
  const por = new Map<string, Cadeia>();
  entrada.pools.forEach((p) => {
    const c = por.get(p.produtoId) ?? { produtoId: p.produtoId, etapas: [] };
    c.etapas.push({ etapaId: p.etapaId, operacaoId: p.operacaoId, ordem: p.ordemEtapa });
    por.set(p.produtoId, c);
  });
  por.forEach((c) => c.etapas.sort((a, b) => a.ordem - b.ordem));
  return [...por.values()].sort((a, b) => (a.produtoId < b.produtoId ? -1 : 1));
}

export interface Trajetoria {
  produtoId: string;
  planejado: number[][]; // [etapa][t] peças planejadas (visão por produto)
  efetivo: number[][]; // [etapa][t] peças que o estoque permite (consumo limitado ao estoque do INÍCIO do período; a perda cascateia)
  ruptura: number[][]; // [etapa][t] planejado − efetivo (etapa ≥ 1)
  saldo: number[][]; // [ligação][t+1] estoque ao FIM do período t (= início de t+1); saldo[l][0] = inicial
  consumoMax: number[][]; // [ligação][t] estoque disponível no início (limite de consumo da etapa seguinte)
}

/** Simula UM plano (linhas gravadas) contra um estoque inicial por ligação. Regra: lote de 1 período — a produção de Tn só existe para a etapa seguinte em Tn+1; o consumo planejado é limitado ao saldo do INÍCIO do período. */
export function simular(entrada: EntradaEscala, linhas: AlocacaoEscala[], wip0: Record<string, number[]>): Trajetoria[] {
  const H = entrada.slots.length;
  const idx = new Map(entrada.slots.map((s) => [`${s.data}|${s.periodoId}`, s.indice]));
  const exp = expandirPorProduto(linhas).filter((a) => a.maquinaId && a.produtoId && a.etapaId);
  return cadeiasDe(entrada).map((c) => {
    const n = c.etapas.length;
    const planejado = c.etapas.map((e) => {
      const v = new Array(H).fill(0);
      exp.filter((a) => a.produtoId === c.produtoId && a.etapaId === e.etapaId).forEach((a) => (v[idx.get(`${a.data}|${a.periodoId}`) as number] += a.pecas));
      return v;
    });
    const efetivo = planejado.map((v) => v.slice());
    const ruptura = planejado.map(() => new Array(H).fill(0));
    const saldo = Array.from({ length: Math.max(0, n - 1) }, (_, l) => [(wip0[c.produtoId]?.[l] ?? 0)]);
    const consumoMax = Array.from({ length: Math.max(0, n - 1) }, () => new Array(H).fill(0));
    for (let t = 0; t < H; t++) {
      for (let k = 1; k < n; k++) {
        const disp = saldo[k - 1][t];
        consumoMax[k - 1][t] = disp;
        const real = Math.min(planejado[k][t], disp);
        efetivo[k][t] = real;
        ruptura[k][t] = planejado[k][t] - real;
      }
      // saldo ao fim de t: + produção efetiva de t da etapa anterior − consumo efetivo de t da etapa seguinte
      for (let l = 0; l < n - 1; l++) saldo[l].push(saldo[l][t] + efetivo[l][t] - efetivo[l + 1][t]);
    }
    return { produtoId: c.produtoId, planejado, efetivo, ruptura, saldo, consumoMax };
  });
}

export const rotuloSlot = (entrada: EntradaEscala, t: number) => `${entrada.slots[t].data.slice(8)}/${entrada.slots[t].data.slice(5, 7)} ${entrada.slots[t].periodoId.toUpperCase()}`;
export const n0 = (v: number) => Math.round(v).toLocaleString("pt-BR");

/** Chave de posto de uma linha (máquina|produto|etapa) — para comparar planos. */
export const chavePosto = (a: AlocacaoEscala) => `${a.maquinaId}|${a.produtoId}|${a.etapaId}`;
export const chavePoolDe = (a: AlocacaoEscala) => chavePool(a.produtoId as string, a.etapaId as string);
