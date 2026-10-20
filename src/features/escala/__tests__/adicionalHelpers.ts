// Verificações compartilhadas dos testes da camada de carga adicional (não é um arquivo de teste).
import { gerarEscala } from "../gerarEscala";
import { chavePool, type EntradaEscala, type PoolEscala, type ResultadoEscala } from "../types";
import { checarInvariantes } from "./helpers";

// postos do PREVISTO de um resultado, por período: (máquina, produto, etapa, peças) — sem olhar quem os ocupa
export function postosPrevistos(r: ResultadoEscala): Map<string, string[]> {
  const m = new Map<string, string[]>();
  r.alocacoes.forEach((a) => {
    if (!a.maquinaId || (a.pecasAdicional ?? 0) > 0) return;
    const k = `${a.data}|${a.periodoId}`;
    m.set(k, [...(m.get(k) ?? []), `${a.maquinaId}|${a.produtoId}|${a.etapaId}|${a.pecas}`]);
  });
  m.forEach((v, k) => m.set(k, v.sort()));
  return m;
}

export function somaPor(r: ResultadoEscala, campo: "pecas" | "pecasAdicional"): Map<string, number> {
  const m = new Map<string, number>();
  r.alocacoes.forEach((a) => {
    if (!a.maquinaId || !a.produtoId || !a.etapaId) return;
    const k = chavePool(a.produtoId, a.etapaId);
    m.set(k, (m.get(k) ?? 0) + (campo === "pecas" ? a.pecas : a.pecasAdicional ?? 0));
  });
  return m;
}

export function comAdicional(e: EntradaEscala, adicional: (p: PoolEscala, i: number) => number): EntradaEscala {
  return { ...e, pools: e.pools.map((p, i) => ({ ...p, adicionalMax: adicional(p, i) })) };
}

// Garantias que valem para QUALQUER cenário com adicional (comparadas com o mesmo cenário sem adicional)
export function conferirInvariantes(base: EntradaEscala, adic: EntradaEscala): string[] {
  const erros: string[] = [];
  const r0 = gerarEscala(base);
  const r1 = gerarEscala(adic);

  erros.push(...checarInvariantes(adic, r1).map((x) => `invariante: ${x}`));

  // 1) o previsto NÃO é deslocado: mesmos postos (máquina/produto/etapa/peças) em todo período
  const p0 = postosPrevistos(r0);
  const p1 = postosPrevistos(r1);
  if (JSON.stringify([...p0.entries()].sort()) !== JSON.stringify([...p1.entries()].sort())) erros.push("postos do previsto mudaram");

  // 2) crédito do previsto e demanda não atendida preservados
  if (JSON.stringify([...somaPor(r0, "pecas").entries()].sort()) !== JSON.stringify([...somaPor(r1, "pecas").entries()].sort())) erros.push("crédito do previsto mudou");
  if (JSON.stringify(r0.pecasRestantes) !== JSON.stringify(r1.pecasRestantes)) erros.push("peças restantes do previsto mudaram");
  const gargalos = (r: ResultadoEscala) => JSON.stringify(r.alertas.filter((a) => a.tipo === "gargalo_sem_operador" || a.tipo === "demanda_nao_atendida"));
  if (gargalos(r0) !== gargalos(r1)) erros.push("alertas de gargalo/demanda do previsto mudaram");

  // 3) o adicional só ocupa quem ficaria sem posto: nº de pessoas no previsto igual; sem posto só diminui
  const porSlot = (r: ResultadoEscala) => {
    const m = new Map<string, { prev: number; adic: number; ocio: number }>();
    r.alocacoes.forEach((a) => {
      const k = `${a.data}|${a.periodoId}`;
      const x = m.get(k) ?? { prev: 0, adic: 0, ocio: 0 };
      if (!a.maquinaId) x.ocio++;
      else if ((a.pecasAdicional ?? 0) > 0) x.adic++;
      else x.prev++;
      m.set(k, x);
    });
    return m;
  };
  const s0 = porSlot(r0);
  const s1 = porSlot(r1);
  s0.forEach((x0, k) => {
    const x1 = s1.get(k)!;
    if (x1.prev !== x0.prev) erros.push(`pessoas no previsto mudaram em ${k}`);
    if (x1.prev + x1.adic + x1.ocio !== x0.prev + x0.ocio) erros.push(`total de pessoas mudou em ${k}`);
    if (x1.ocio > x0.ocio) erros.push(`ociosidade aumentou em ${k}`);
    if (x1.adic !== x0.ocio - x1.ocio) erros.push(`adicional não ocupou exatamente quem estava ocioso em ${k}`);
  });

  // 4) adicional só em máquina livre (nenhuma máquina usada pelo previsto) — a unicidade já é checada em checarInvariantes
  // 5) nunca acima do teto por pool
  const teto = new Map(adic.pools.map((p) => [chavePool(p.produtoId, p.etapaId), p.adicionalMax ?? 0]));
  somaPor(r1, "pecasAdicional").forEach((v, k) => {
    if (v > (teto.get(k) ?? 0) + 1e-6) erros.push(`adicional acima do teto em ${k}: ${v} > ${teto.get(k)}`);
  });
  r1.alocacoes.forEach((a) => {
    if ((a.pecasAdicional ?? 0) > 0 && a.pecas !== 0) erros.push("posto de adicional com crédito de previsto");
    if (!a.maquinaId && (a.pecasAdicional ?? 0) !== 0) erros.push("sem posto com adicional");
  });
  return erros;
}

