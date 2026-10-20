// Sugestão de CARGA ADICIONAL de produto acabado — usa o MESMO motor.
//
// Regra (decisão de negócio): só se sugere adicional que FECHE PRODUTO ACABADO. Para um
// produto com várias etapas, a sugestão é limitada pela etapa de MENOR capacidade
// adicional — nada de produzir estoque intermediário deliberadamente.
//
// Como: ponto fixo sobre o motor de duas camadas.
//   1) cada produto elegível recebe teto "ilimitado" de adicional e o motor roda;
//      cada etapa absorve o que a capacidade ociosa permite;
//   2) o teto do produto passa a ser o MÍNIMO entre as etapas dele;
//   3) roda de novo com esses tetos (as pessoas liberadas podem ir para outros produtos,
//      que continuam limitados pelo próprio teto) e repete até estabilizar.
// No ponto fixo todas as etapas do produto absorvem exatamente o mesmo adicional.
// 4) REAPROVEITAMENTO: um produto que ficou com teto 0 só porque competia por uma máquina
//    compartilhada com outro produto (que depois foi limitado por outra etapa e liberou a máquina)
//    ganha uma segunda chance — sem tirar nada dos que já têm teto (o motor confirma).
// O previsto nunca é tocado (garantia do próprio motor, coberta por teste).

import { gerarEscala } from "./gerarEscala";
import { chavePool, type EntradaEscala, type PoolEscala } from "./types";

const TETO_ILIMITADO = 1_000_000_000;
const MAX_ITERACOES = 25;

export interface SugestaoEtapa {
  etapaId: string;
  ordem: number;
  absorveria: number; // capacidade adicional da etapa isolada (1ª rodada, sem limite por produto)
  limitante: boolean;
}

export interface SugestaoProduto {
  produtoId: string;
  adicionalSugerido: number; // peças de produto acabado
  porEtapa: SugestaoEtapa[];
  etapaLimitanteId: string | null;
  valorUnitario: number;
  valorPotencial: number; // indicador SEPARADO: nunca soma ao faturamento previsto
  motivoSemSugestao?: "etapa_sem_maquina" | "sem_capacidade_ociosa";
}

export interface ResultadoSugestao {
  porProduto: SugestaoProduto[];
  entradaComSugestao: EntradaEscala;
  iteracoes: number;
  totalPecas: number;
  valorPotencial: number;
}

function comTetos(entrada: EntradaEscala, tetoPorProduto: Map<string, number>): EntradaEscala {
  return { ...entrada, pools: entrada.pools.map((p) => ({ ...p, adicionalMax: tetoPorProduto.get(p.produtoId) ?? 0 })) };
}

// REGRA DURA: a carga adicional só pode aumentar a quantidade de PRODUTOS JÁ PREVISTOS na semana.
// `produtosPermitidos` (quando informado) é a lista desses produtos — qualquer outro produto presente
// na entrada NUNCA recebe teto, aconteça o que acontecer (valor, produtividade, capacidade ociosa…).
export function sugerirAdicional(entrada: EntradaEscala, opcoes: { produtosIncompletos?: Set<string>; produtosPermitidos?: Set<string> } = {}): ResultadoSugestao {
  const incompletos = opcoes.produtosIncompletos ?? new Set<string>();
  const permitidos = opcoes.produtosPermitidos;
  const porProduto = new Map<string, PoolEscala[]>();
  [...entrada.pools].forEach((p) => {
    if (!porProduto.has(p.produtoId)) porProduto.set(p.produtoId, []);
    porProduto.get(p.produtoId)!.push(p);
  });
  const produtos = [...porProduto.keys()].filter((p) => !permitidos || permitidos.has(p)).sort();
  porProduto.forEach((l) => l.sort((a, b) => a.ordemEtapa - b.ordemEtapa || (a.etapaId < b.etapaId ? -1 : 1)));

  let tetos = new Map<string, number>(produtos.map((p) => [p, incompletos.has(p) ? 0 : TETO_ILIMITADO]));
  let primeira: Map<string, number> | null = null;
  let iteracoes = 0;

  for (let it = 1; it <= MAX_ITERACOES; it++) {
    iteracoes = it;
    const r = gerarEscala(comTetos(entrada, tetos));
    const absorvido = (produtoId: string, etapaId: string) => r.adicionalProduzido[chavePool(produtoId, etapaId)] ?? 0;
    if (!primeira) {
      primeira = new Map();
      entrada.pools.forEach((p) => primeira!.set(chavePool(p.produtoId, p.etapaId), absorvido(p.produtoId, p.etapaId)));
    }
    const novos = new Map<string, number>();
    produtos.forEach((produto) => {
      if ((tetos.get(produto) ?? 0) <= 0) {
        novos.set(produto, 0);
        return;
      }
      const minimo = Math.min(...(porProduto.get(produto) as PoolEscala[]).map((p) => absorvido(p.produtoId, p.etapaId)));
      novos.set(produto, Math.floor(minimo + 1e-9));
    });
    const igual = produtos.every((p) => novos.get(p) === tetos.get(p));
    tetos = novos;
    if (igual) break;
  }

  // ---- 4) reaproveitamento (segunda chance para produtos com teto 0 que só perderam a disputa) ----
  const absorvidoMin = (r: ReturnType<typeof gerarEscala>, produto: string) =>
    Math.min(...(porProduto.get(produto) as PoolEscala[]).map((p) => r.adicionalProduzido[chavePool(p.produtoId, p.etapaId)] ?? 0));
  const valorDe = (produto: string) => (porProduto.get(produto) as PoolEscala[])[0].valorUnitario;
  const candidatos = produtos.filter((p) => !incompletos.has(p)).sort((a, b) => valorDe(b) - valorDe(a) || (a < b ? -1 : 1));
  for (let rodada = 0; rodada < 3; rodada++) {
    let melhorou = false;
    for (const produto of candidatos) {
      if ((tetos.get(produto) ?? 0) > 0) continue;
      let c = TETO_ILIMITADO;
      let aceito = 0;
      for (let k = 0; k < 20; k++) {
        iteracoes++;
        const t = new Map(tetos);
        t.set(produto, c);
        const r = gerarEscala(comTetos(entrada, t));
        const ap = Math.floor(absorvidoMin(r, produto) + 1e-9);
        if (ap <= 0) break;
        const outrosIntactos = produtos.every((q) => q === produto || (tetos.get(q) ?? 0) <= 0 || absorvidoMin(r, q) >= (tetos.get(q) as number) - 1e-6);
        if (outrosIntactos) {
          if (c !== TETO_ILIMITADO && Math.abs(ap - c) < 1e-6) {
            aceito = c; // as etapas do produto absorvem exatamente o teto e ninguém perdeu nada
            break;
          }
          c = ap;
        } else {
          c = Math.floor((c === TETO_ILIMITADO ? ap : Math.min(c, ap)) / 2); // está tirando de outros produtos: reduz
          if (c < 1) break;
        }
      }
      if (aceito > 0) {
        tetos.set(produto, aceito);
        melhorou = true;
      }
    }
    if (!melhorou) break;
  }

  const sugestoes: SugestaoProduto[] = produtos.map((produto) => {
    const pools = porProduto.get(produto) as PoolEscala[];
    const etapas = pools.map((p) => ({ etapaId: p.etapaId, ordem: p.ordemEtapa, absorveria: (primeira as Map<string, number>).get(chavePool(p.produtoId, p.etapaId)) ?? 0 }));
    const minimo = Math.min(...etapas.map((e) => e.absorveria));
    const limitante = etapas.find((e) => e.absorveria === minimo) ?? null;
    const adicional = tetos.get(produto) ?? 0;
    const valorUnitario = pools[0].valorUnitario;
    return {
      produtoId: produto,
      adicionalSugerido: adicional,
      porEtapa: etapas.map((e) => ({ ...e, limitante: limitante !== null && e.etapaId === limitante.etapaId })),
      etapaLimitanteId: limitante?.etapaId ?? null,
      valorUnitario,
      valorPotencial: adicional * valorUnitario,
      motivoSemSugestao: adicional > 0 ? undefined : incompletos.has(produto) ? "etapa_sem_maquina" : "sem_capacidade_ociosa",
    };
  });

  return {
    porProduto: sugestoes,
    entradaComSugestao: comTetos(entrada, tetos),
    iteracoes,
    totalPecas: sugestoes.reduce((s, x) => s + x.adicionalSugerido, 0),
    valorPotencial: sugestoes.reduce((s, x) => s + x.valorPotencial, 0),
  };
}
