// Estrutura de um produto: rotas, pool comum (convergência) e etapa FINAL. Único ponto que decide "qual é a próxima etapa" e "qual é a etapa final":
//   • produto LINEAR (legado): próxima = ordem imediatamente maior; final = maior ordem (regra atual, preservada);
//   • produto de ROTAS: próxima/final vêm do modelo (rota exclusiva → pool comum → final EXPLÍCITA). NUNCA max(ordem)/ordem+1.
import type { Convergencia, EstruturaProduto, EtapaCadastro, RotaEstrutura } from "./tipos";

// Produto sem rotas cadastradas → rota única implícita (idêntica ao roteiro linear de hoje)
export function estruturaLinear(produtoId: string, etapas: Pick<EtapaCadastro, "id" | "ordem">[]): EstruturaProduto {
  const ordenadas = [...etapas].sort((a, b) => a.ordem - b.ordem || (a.id < b.id ? -1 : 1));
  return {
    produtoId, modelo: "linear", regraEtapaFinal: "max_ordem_legado",
    rotas: [{ id: null, codigo: "IMPLICITA", nome: "Rota única (legado)", ativa: true, preferencia: 100, etapas: ordenadas.map((e) => e.id) }],
    poolComum: null, convergencia: null,
    etapaFinalId: ordenadas.length > 0 ? ordenadas[ordenadas.length - 1].id : null,
  };
}

// convergência derivada da estrutura: a última etapa EXCLUSIVA de cada rota ativa → primeira etapa comum
export function convergenciaDe(rotas: RotaEstrutura[], poolComum: EstruturaProduto["poolComum"]): Convergencia | null {
  if (!poolComum) return null;
  return { destinoId: poolComum.entradaId, origens: rotas.filter((r) => r.ativa && r.etapas.length > 0).map((r) => ({ rotaCodigo: r.codigo, etapaId: r.etapas[r.etapas.length - 1] })) };
}

// JSON devolvido pelo banco (produto_estrutura_rotas) → tipo do código
export function estruturaDoBanco(j: {
  produtoId: string; modelo: "linear" | "rotas"; regraEtapaFinal: "max_ordem_legado" | "explicita";
  rotas: { id: string | null; codigo: string; nome: string; ativa: boolean; preferencia: number; etapas: string[] }[];
  poolComum: { etapas: string[]; entradaId: string } | null; etapaFinalId: string | null;
  convergencia?: Convergencia | null;
}): EstruturaProduto {
  const rotas = j.rotas.map((r) => ({ ...r }));
  const poolComum = j.poolComum ? { etapas: [...j.poolComum.etapas], entradaId: j.poolComum.entradaId } : null;
  return { produtoId: j.produtoId, modelo: j.modelo, regraEtapaFinal: j.regraEtapaFinal, rotas, poolComum, convergencia: j.convergencia ?? convergenciaDe(rotas, poolComum), etapaFinalId: j.etapaFinalId };
}

export const todasAsEtapas = (e: EstruturaProduto): string[] => [...e.rotas.flatMap((r) => r.etapas), ...(e.poolComum?.etapas ?? [])];

// CAMINHO FÍSICO de uma peça fabricada por uma rota: trecho EXCLUSIVO da rota + fluxo COMUM (a rota em si é só o trecho exclusivo; as etapas comuns não pertencem a nenhuma rota)
export function percursoDaPeca(e: EstruturaProduto, codigo: string): string[] {
  const r = e.rotas.find((x) => x.codigo === codigo);
  return r ? [...r.etapas, ...(e.poolComum?.etapas ?? [])] : [];
}

// etapas que alimentam esta etapa (várias na convergência)
export function etapasAnteriores(e: EstruturaProduto, etapaId: string): string[] {
  const pool = e.poolComum;
  if (pool && etapaId === pool.entradaId) return e.rotas.map((r) => r.etapas[r.etapas.length - 1]).filter((x): x is string => !!x);
  if (pool) { const i = pool.etapas.indexOf(etapaId); if (i > 0) return [pool.etapas[i - 1]]; }
  for (const r of e.rotas) { const i = r.etapas.indexOf(etapaId); if (i > 0) return [r.etapas[i - 1]]; }
  return [];
}
export function etapasSeguintes(e: EstruturaProduto, etapaId: string): string[] {
  const pool = e.poolComum;
  if (pool) { const i = pool.etapas.indexOf(etapaId); if (i >= 0) return i + 1 < pool.etapas.length ? [pool.etapas[i + 1]] : []; }
  for (const r of e.rotas) {
    const i = r.etapas.indexOf(etapaId);
    if (i >= 0) return i + 1 < r.etapas.length ? [r.etapas[i + 1]] : pool ? [pool.entradaId] : [];
  }
  return [];
}
export const ehEtapaFinal = (e: EstruturaProduto, etapaId: string): boolean => e.etapaFinalId === etapaId;
export const rotaDaEtapa = (e: EstruturaProduto, etapaId: string): RotaEstrutura | null => e.rotas.find((r) => r.etapas.includes(etapaId)) ?? null; // comum = null

// Problemas de integridade (espelha produto_rotas_validar do banco) — lista vazia = estrutura válida
export function validarEstrutura(e: EstruturaProduto, etapas: Pick<EtapaCadastro, "id" | "operacaoId">[]): string[] {
  const erros: string[] = [];
  if (e.modelo === "linear") return erros;
  if (e.rotas.length < 2) erros.push("precisa de pelo menos duas rotas");
  if (!e.poolComum || e.poolComum.etapas.length === 0) erros.push("sem pool comum (convergência)");
  const pool = e.poolComum?.etapas ?? [];
  if (e.etapaFinalId === null || !pool.includes(e.etapaFinalId)) erros.push("etapa final precisa estar no pool comum");
  else if (pool[pool.length - 1] !== e.etapaFinalId) erros.push("a etapa final precisa ser a última do pool comum");
  e.rotas.forEach((r) => { if (r.etapas.length === 0) erros.push(`rota ${r.codigo} sem etapas exclusivas`); });
  const vistas = new Map<string, number>();
  todasAsEtapas(e).forEach((id) => vistas.set(id, (vistas.get(id) ?? 0) + 1));
  etapas.forEach((x) => { if ((vistas.get(x.id) ?? 0) !== 1) erros.push(`etapa ${x.id} não está em exatamente um lugar`); });
  const opDe = new Map(etapas.map((x) => [x.id, x.operacaoId]));
  const opsComuns = pool.map((id) => opDe.get(id));
  if (new Set(opsComuns).size !== opsComuns.length) erros.push("operação repetida no pool comum");
  const opsExclusivas = new Set(e.rotas.flatMap((r) => r.etapas).map((id) => opDe.get(id)));
  if (opsComuns.some((op) => opsExclusivas.has(op))) erros.push("operação comum também aparece como etapa exclusiva (ex.: \"Etiquetar CONV\")");
  return erros;
}
