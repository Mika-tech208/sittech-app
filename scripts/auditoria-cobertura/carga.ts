/* eslint-disable @typescript-eslint/no-explicit-any */
// Carga dos dados de PROD (SOMENTE SELECT) para a ferramenta de custo de WIP. Os .sql de ./sql são modelos (__SEMANA__, __SEMANA_FIM__, __ANTES_ISO__);
// a busca copia cada um para o diretório de cache, chama o executor de SELECT e lê o JSON {rows:[...]} do .out. Sem rede: --cache reaproveita os .out.
import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import type { ApontamentoReal } from "@/features/escala/producaoReal";
import type { AlocacaoEscala } from "@/features/escala/types";
import { desempacotarLinha } from "@/features/escala/snapshotSombra";
import { lerConfigFluxo, type ConfigFluxo } from "@/lib/escala/fluxo/parametrosFluxo";
import type { DecisaoGravada } from "../escala-fluxo-replay/dados";

const AQUI = __dirname;
export const SCRATCH = "/private/tmp/claude-501/-Users-mikaellonghi-Documents/46f8091f-a2ac-4875-a213-e5a3b744b594/scratchpad";
export const CACHE = process.env.ATING_CACHE ?? path.join(SCRATCH, "ating", "cache");
/** Executor de SELECT em PROD: `bash <exec> <arquivo.sql>` grava <arquivo.sql>.out com o JSON. Configurável por ATING_RODAPROD. */
export const RODAPROD = process.env.ATING_RODAPROD ?? path.join(SCRATCH, "rodaprod.sh");

export interface ParamsBusca { semana: string; antesIso: string; depoisIso: string; usarCache: boolean; /** só estas consultas (nomes sem .sql); as demais voltam como [] */ somente?: string[] }

const somaDias = (iso: string, n: number) => new Date(Date.parse(iso + "T12:00:00Z") + n * 86400000).toISOString().slice(0, 10);

function lerOut(arq: string): any[] | null {
  if (!fs.existsSync(arq)) return null;
  const t = fs.readFileSync(arq, "utf8");
  const i = t.indexOf("{");
  if (i < 0) return null;
  try { return JSON.parse(t.slice(i)).rows; } catch { return null; }
}

export function buscar(p: ParamsBusca): Record<string, any[]> {
  fs.mkdirSync(CACHE, { recursive: true });
  const out: Record<string, any[]> = {};
  const nomes = fs.readdirSync(path.join(AQUI, "sql")).filter((f) => f.endsWith(".sql")).map((f) => f.replace(/\.sql$/, ""));
  for (const nome of nomes) {
    if (p.somente && !p.somente.includes(nome)) { out[nome] = []; continue; }
    const arq = path.join(CACHE, nome + ".sql");
    let rows: any[] | null = null;
    if (p.usarCache) rows = lerOut(arq + ".out");
    if (!rows) {
      const sql = fs.readFileSync(path.join(AQUI, "sql", nome + ".sql"), "utf8").replaceAll("__SEMANA_FIM__", somaDias(p.semana, 7)).replaceAll("__SEMANA__", p.semana).replaceAll("__ANTES_ISO__", p.antesIso).replaceAll("__DEPOIS_ISO__", p.depoisIso);
      fs.writeFileSync(arq, sql);
      for (let tent = 1; tent <= 4 && !rows; tent++) {
        try { fs.rmSync(arq + ".out", { force: true }); execFileSync("bash", [RODAPROD, arq], { stdio: "ignore", timeout: 170000 }); } catch { /* repete ("login role timed out") */ }
        rows = lerOut(arq + ".out");
      }
      if (!rows) throw new Error(`falha ao buscar ${nome} em PROD (ver ${arq}.out)`);
    }
    out[nome] = rows;
  }
  return out;
}

export interface DadosCarregados {
  decisao: DecisaoGravada;
  apontamentos: (ApontamentoReal & { id: string })[];
  cfg: ConfigFluxo;
  planoAtual: AlocacaoEscala[];
  versaoDepois: DadosCarregados["versaoAntes"];
  versaoAntes: { id: string; origem: string; validoMs: number; valido: string; linhas: AlocacaoEscala[] } | null;
  fluxo: any[];
  nomes: Record<string, string>;
  parametrosAtualizadoMs: Record<string, number>;
}

export function carregar(b: Record<string, any[]>): DadosCarregados {
  const r = b.q_dec[0];
  const decisao: DecisaoGravada = {
    id: r.id, data: r.data, periodoId: r.periodo_id, slot: r.slot, revisao: r.revisao, modo: r.replanejamento_modo, criadoEm: r.criado_em, corteMs: r.entrada.corteMs,
    hashDecisao: r.hash_decisao, hashPlanoSombra: r.hash_plano_sombra, faltaOficialGravada: Number(r.falta_of), faltaSombraGravada: Number(r.falta_so), entrada: r.entrada,
  };
  const apontamentos = b.q_apont.map((a) => ({
    id: a.id, data: a.data, periodoId: a.periodo_id, funcionarioId: a.funcionario_id, maquinaId: a.maquina_id, produtoId: a.produto_id, etapaId: a.etapa_id, operacaoId: a.operacao_id,
    boas: Number(a.quantidade_produzida) - Number(a.quantidade_refugo), refugo: Number(a.quantidade_refugo), meta: Number(a.meta), status: (a.status === "produzindo" ? "produzindo" : "sem_producao") as "produzindo" | "sem_producao",
    motivo: a.motivo, lancadoEmMs: Math.round(Number(a.criado_ms)),
  }));
  const cfg = lerConfigFluxo(b.q_par.map((x) => ({ chave: x.chave, valor: JSON.parse(x.valor) })));
  const planoAtual: AlocacaoEscala[] = b.q_aloc.map((a) => ({
    data: a.data, periodoId: a.periodo_id, funcionarioId: a.funcionario_id, maquinaId: a.maquina_id, produtoId: a.produto_id, etapaId: a.etapa_id, operacaoId: a.operacao_id,
    pecas: Number(a.pecas), ...(Number(a.pecas_adicional) > 0 ? { pecasAdicional: Number(a.pecas_adicional) } : {}), ...(a.tipo_adicional ? { tipoAdicional: a.tipo_adicional } : {}),
    motivoSemPosto: a.motivo_sem_posto, excecaoRevezamento: !!a.excecao_revezamento, motivoExcecao: a.motivo_excecao, origem: a.origem === "manual" ? "manual" : "auto",
  }));
  const v = b.q_ver[0];
  const versaoAntes = v ? { id: v.id, origem: v.origem, validoMs: Math.round(Number(v.valido_ms)), valido: v.valido, linhas: (v.linhas as any[]).map(desempacotarLinha) } : null;
  const v2 = b.q_ver_depois[0];
  const versaoDepois = v2 ? { id: v2.id, origem: v2.origem, validoMs: Math.round(Number(v2.valido_ms)), valido: v2.valido, linhas: (v2.linhas as any[]).map(desempacotarLinha) } : null;
  const nomes: Record<string, string> = {};
  b.q_nomes.forEach((x) => (nomes[x.id] = x.nome));
  const parametrosAtualizadoMs: Record<string, number> = {};
  b.q_par.forEach((x) => (parametrosAtualizadoMs[x.chave] = Math.round(Number(x.atualizado_ms))));
  return { decisao, apontamentos, cfg, planoAtual, versaoAntes, versaoDepois, fluxo: b.q_fluxo, nomes, parametrosAtualizadoMs };
}
