// "Funcionários necessários" — busca PURA do menor número de pessoas que executa a programação prevista SEM PERDA de produção.
//
// Definição (aprovada): a referência é o MÁXIMO que a programação entrega com as máquinas selecionadas, medido com uma equipe virtual
// suficientemente grande. Falta que sobra mesmo com gente de sobra é LIMITE FÍSICO DE MÁQUINA (ex.: máquina a 200%) e NÃO conta como
// falta de gente. O número procurado é o menor N cuja produção é igual à da referência.
//
// "Mesma produção" = para TODA etapa (produto|etapa), a falta com N pessoas não excede a falta da referência além de `tolerancia`
// (peças). Como a quantidade de cada etapa é fixa, "falta igual" ⇔ "peças creditadas iguais". A comparação é por etapa, não só pelo
// total, para que um ganho numa etapa não esconda perda em outra. Tolerância padrão: 1e-6 peça (os créditos do motor são somas de
// metas inteiras e restos; o erro numérico é da ordem de 1e-9, o EPS do motor).
//
// Busca: binária sobre [1, nMax], porque a produção NÃO é provadamente monótona em N (motor guloso + atribuição húngara + revezamento).
// A monotonicidade é VERIFICADA nos vizinhos do resultado (N-1 não pode igualar, N+1 tem de igualar) e em todas as rodadas já
// avaliadas; se algo contradisser, cai para varredura linear 1..nMax (primeiro N que iguala) e marca `monotonico: false`.
// Limite conhecido: não-monotonia LONGE do limiar não é vista pela binária; por isso a monotonicidade foi conferida por varredura completa
// 1..nMax nas Previsões reais de PROD (ver relatório da implementação).
//
// PURO: não conhece motor, banco nem relógio; quem produz a rodada de cada N é injetado (`produzir`).

export const TOLERANCIA_PECAS = 1e-6;

export interface RodadaEquipe {
  n: number;
  /** peças que continuam faltando no fim da semana, por "produto|etapa" */
  faltaPorEtapa: Record<string, number>;
  /** peças creditadas ao previsto, por "produto|etapa" */
  creditoPorEtapa: Record<string, number>;
}

export const soma = (r: Record<string, number>): number => Object.values(r).reduce((s, v) => s + v, 0);

/** Produção de `r` é igual à da referência: nenhuma etapa falta mais (além da tolerância) do que faltava com a equipe de referência. */
export function igualReferencia(r: RodadaEquipe, ref: RodadaEquipe, tolerancia = TOLERANCIA_PECAS): boolean {
  const chaves = new Set([...Object.keys(ref.faltaPorEtapa), ...Object.keys(r.faltaPorEtapa)]);
  for (const k of chaves) {
    if ((r.faltaPorEtapa[k] ?? 0) > (ref.faltaPorEtapa[k] ?? 0) + tolerancia) return false;
  }
  return true;
}

export interface OpcoesBuscaEquipe {
  /** tamanho da equipe virtual de referência (grande o bastante para que nada falte por falta de gente) */
  nMax: number;
  /** roda a Escala com `n` pessoas virtuais e devolve a produção */
  produzir: (n: number) => RodadaEquipe;
  tolerancia?: number;
}

export interface ResultadoBuscaEquipe {
  /** menor N que iguala a referência; 0 quando a programação não produz nada (nada a executar) */
  n: number;
  nMax: number;
  referencia: RodadaEquipe;
  /** todas as rodadas avaliadas, ordenadas por N (referência incluída) */
  rodadas: RodadaEquipe[];
  /** rodadas em que a produção iguala a referência */
  iguala: Record<number, boolean>;
  metodo: "binaria" | "varredura";
  /** false = a verificação de vizinhança acusou não-monotonia e o resultado veio da varredura linear */
  monotonico: boolean;
  tolerancia: number;
}

export function buscarMenorEquipe({ nMax, produzir, tolerancia = TOLERANCIA_PECAS }: OpcoesBuscaEquipe): ResultadoBuscaEquipe {
  const cache = new Map<number, RodadaEquipe>();
  const rodar = (n: number): RodadaEquipe => {
    let r = cache.get(n);
    if (!r) {
      r = produzir(n);
      cache.set(n, r);
    }
    return r;
  };
  const referencia = rodar(Math.max(1, nMax));
  const ok = (n: number) => igualReferencia(rodar(n), referencia, tolerancia);
  const montar = (n: number, metodo: ResultadoBuscaEquipe["metodo"], monotonico: boolean): ResultadoBuscaEquipe => {
    const rodadas = [...cache.values()].sort((a, b) => a.n - b.n);
    return { n, nMax: Math.max(1, nMax), referencia, rodadas, iguala: Object.fromEntries(rodadas.map((r) => [r.n, igualReferencia(r, referencia, tolerancia)])), metodo, monotonico, tolerancia };
  };

  // nada é produzido nem com equipe grande: não há o que executar
  if (nMax < 1 || soma(referencia.creditoPorEtapa) <= tolerancia) return montar(0, "binaria", true);

  let lo = 1;
  let hi = Math.max(1, nMax);
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (ok(mid)) hi = mid;
    else lo = mid + 1;
  }
  const n = lo;

  // verificação de monotonicidade: N iguala, N-1 não iguala, N+1 iguala, e nada já avaliado contradiz o limiar
  const vizinhosOk = ok(n) && (n === 1 || !ok(n - 1)) && (n + 1 > Math.max(1, nMax) || ok(n + 1));
  const contradicao = [...cache.keys()].some((k) => (k < n && ok(k)) || (k >= n && !ok(k)));
  if (vizinhosOk && !contradicao) return montar(n, "binaria", true);

  for (let k = 1; k <= Math.max(1, nMax); k++) if (ok(k)) return montar(k, "varredura", false);
  return montar(Math.max(1, nMax), "varredura", false);
}
