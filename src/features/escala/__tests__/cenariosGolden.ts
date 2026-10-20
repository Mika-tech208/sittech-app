// Cenários fixos usados no teste de NÃO-REGRESSÃO do motor: com adicional = 0 a
// saída tem de ser byte-a-byte a do motor ANTES da camada de adicional. Os hashes
// em __fixtures__/golden_sem_adicional.json foram gerados com o motor anterior.
import { createHash } from "node:crypto";
import fixture from "../__fixtures__/semanas_reais.json";
import { gerarEscala } from "../gerarEscala";
import type { AlocacaoEscala, EntradaEscala, PoolEscala } from "../types";
import { entrada, equipe, pool } from "./helpers";

const DIAS_SEMANA = ["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23"];
const semanas = fixture.semanas as { semanaInicio: string; pools: PoolEscala[] }[];

let seed = 20261020;
function rnd(): number {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
}

export function cenariosGolden(): { nome: string; entrada: EntradaEscala }[] {
  seed = 20261020;
  const lista: { nome: string; entrada: EntradaEscala }[] = [];

  // semanas reais × tamanhos de equipe
  semanas.forEach((s) => {
    [14, 16, 18].forEach((n) => {
      lista.push({ nome: `real ${s.semanaInicio} N=${n}`, entrada: entrada({ pools: s.pools, funcionarios: equipe(n) }, DIAS_SEMANA) });
    });
  });

  // ausências (dia inteiro e janelas) em semana real
  const base = semanas[4];
  const funcs = equipe(16);
  const ausencias = DIAS_SEMANA.flatMap((data) =>
    funcs.filter(() => rnd() < 0.12).map((f) => ({ funcionarioId: f.id, data, inicioMin: rnd() < 0.5 ? null : 13 * 60, fimMin: rnd() < 0.5 ? null : 15 * 60 }))
  ).map((a) => (a.inicioMin === null || a.fimMin === null ? { ...a, inicioMin: null, fimMin: null } : a));
  lista.push({ nome: "real 19/10 N=16 com ausências", entrada: entrada({ pools: base.pools, funcionarios: funcs, ausencias }, DIAS_SEMANA) });

  // máquina indisponível (Previsão e recurso bloqueado a partir de quarta)
  const maquinas = [...new Set(base.pools.flatMap((p) => p.maquinasIds))].sort();
  lista.push({
    nome: "real 19/10 N=18 com recursos indisponíveis",
    entrada: entrada(
      {
        pools: base.pools,
        funcionarios: equipe(18),
        maquinasIndisponiveisPrevisao: [maquinas[0]],
        indisponibilidades: [{ maquinaId: maquinas[1], desdeMs: Date.parse("2026-10-21T10:00:00Z"), liberadaEmMs: null }],
      },
      DIAS_SEMANA
    ),
  });

  // com histórico de equidade (minutos)
  lista.push({
    nome: "real 19/10 N=16 com histórico de equidade",
    entrada: entrada(
      {
        pools: base.pools,
        funcionarios: funcs,
        historicoEquidade: funcs.map((f, i) => ({ funcionarioId: f.id, minutosDisponiveis: 4000 + i * 50, porOperacao: {}, porMaquina: {} })),
      },
      DIAS_SEMANA
    ),
  });

  // regeração a partir de um prefixo congelado (primeiros 10 períodos)
  const e0 = entrada({ pools: base.pools, funcionarios: equipe(16) }, DIAS_SEMANA);
  const r0 = gerarEscala(e0);
  const corte = 10;
  const congeladas = r0.alocacoes.filter((a) => (e0.slots.find((s) => s.data === a.data && s.periodoId === a.periodoId)?.indice ?? 0) < corte);
  lista.push({ nome: "regeração com prefixo congelado", entrada: { ...e0, aPartirDe: corte, congeladas: congeladas as AlocacaoEscala[] } });

  // sintéticos pequenos: gargalo, rotação forçada, demanda esgotada, vários pools/máquinas
  lista.push({
    nome: "sintético gargalo + valor",
    entrada: entrada({ funcionarios: equipe(3), pools: [pool({ produto: "pG", op: "A", q: 600, maquinas: ["mG"], valor: 1 }), pool({ produto: "pV", op: "B", q: 100, maquinas: ["mV"], valor: 1000 }), pool({ produto: "pC", op: "C", q: 5000, maquinas: ["mC1", "mC2"] })] }),
  });
  lista.push({
    nome: "sintético rotação inevitável",
    entrada: entrada({ funcionarios: equipe(2), pools: [pool({ produto: "p1", op: "A", q: 100000, maquinas: ["m1", "m2"] })] }, ["2026-10-19", "2026-10-20"]),
  });
  lista.push({
    nome: "sintético demanda esgotada cedo",
    entrada: entrada({ funcionarios: equipe(6), pools: [1, 2, 3, 4].map((n) => pool({ produto: `p${n}`, op: `op${n}`, q: 250 * n, maquinas: [`m${n}`] })) }, DIAS_SEMANA),
  });

  return lista;
}

export function hashDaSaida(e: EntradaEscala): string {
  const r = gerarEscala(e);
  return createHash("sha256").update(JSON.stringify({ a: r.alocacoes, al: r.alertas, rs: r.resumoSlots, p: r.pecasRestantes, pg: r.primeiraGeracaoComSemanaEmAndamento })).digest("hex");
}
