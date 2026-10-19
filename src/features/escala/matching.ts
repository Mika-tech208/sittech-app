// Problema de atribuição (min-cost assignment) — algoritmo húngaro O(n³) com
// potenciais. Matriz quadrada n×n de custos finitos; devolve, para cada
// linha, a coluna atribuída. Determinístico: mesma matriz => mesma
// atribuição (empates resolvidos pela ordem de linhas/colunas).

export function atribuicaoMinima(custo: number[][]): number[] {
  const n = custo.length;
  if (n === 0) return [];
  const INF = Number.POSITIVE_INFINITY;
  const u = new Array<number>(n + 1).fill(0);
  const v = new Array<number>(n + 1).fill(0);
  const p = new Array<number>(n + 1).fill(0); // p[j] = linha atribuída à coluna j
  const way = new Array<number>(n + 1).fill(0);

  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Array<number>(n + 1).fill(INF);
    const usado = new Array<boolean>(n + 1).fill(false);
    do {
      usado[j0] = true;
      const i0 = p[j0];
      let delta = INF;
      let j1 = 0;
      for (let j = 1; j <= n; j++) {
        if (usado[j]) continue;
        const atual = custo[i0 - 1][j - 1] - u[i0] - v[j];
        if (atual < minv[j]) {
          minv[j] = atual;
          way[j] = j0;
        }
        if (minv[j] < delta) {
          delta = minv[j];
          j1 = j;
        }
      }
      for (let j = 0; j <= n; j++) {
        if (usado[j]) {
          u[p[j]] += delta;
          v[j] -= delta;
        } else {
          minv[j] -= delta;
        }
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0 !== 0);
  }

  const resultado = new Array<number>(n).fill(-1);
  for (let j = 1; j <= n; j++) resultado[p[j] - 1] = j - 1;
  return resultado;
}
