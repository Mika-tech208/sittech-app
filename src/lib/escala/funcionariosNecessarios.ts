// "Funcionários necessários para executar esta programação" — SOMENTE LEITURA (nada é gravado).
//
// Roda o MESMO motor que gera a Escala (montarEntradaEscala + gerarEscala, via simularSemana) com uma equipe VIRTUAL e procura o menor
// número de pessoas que entrega a mesma produção que uma equipe grande (buscarMenorEquipe, puro). A equipe real, as ausências e o
// histórico de equidade NÃO entram: o número é da PROGRAMAÇÃO, não da equipe existente. Só o PREVISTO conta (a carga adicional existe
// para ocupar gente sem posto, nunca para dimensionar a equipe). Máquinas, metas, indisponibilidades, parâmetros (revezamento duro,
// escopo, WIP) e o calendário são os da Previsão/banco, sem alteração. Ver src/features/escala/menorEquipe.ts para a definição de
// "mesma produção" e a política de busca.
//
// Falta que sobra com equipe grande = limite físico de máquina (ex.: máquina a 200%): vai em `faltaPorLimiteDeMaquina`, não em gente.

import { buscarMenorEquipe, soma, TOLERANCIA_PECAS, type ResultadoBuscaEquipe, type RodadaEquipe } from "@/features/escala/menorEquipe";
import { chavePool } from "@/features/escala/types";
import type { AvisoMontagem, EstadoBruto } from "./estado";
import { simularSemana } from "./simularCobertura";

export interface EtapaProducao {
  produtoId: string;
  produto: string;
  etapaId: string;
  operacao: string;
  creditada: number;
  falta: number;
}

export interface LinhaComparacao {
  n: number;
  rotulo: "equipe de referência" | "N-1" | "N" | "N+1";
  creditoTotal: number;
  faltaTotal: number;
  /** peças a menos do que a referência (≥ 0) */
  perdaVsReferencia: number;
  igualReferencia: boolean;
}

export interface FuncionariosNecessariosResultado {
  semanaInicio: string;
  /** o número oficial; 0 = nada a executar (sem máquinas selecionadas / sem demanda) */
  funcionariosNecessarios: number;
  maquinasEnvolvidas: { total: number; maquinas: { id: string; nome: string; produtos: string[] }[] };
  equipeReferencia: number;
  /** o que a programação entrega com a equipe de referência, por etapa (inclui a falta que é de máquina) */
  producaoReferencia: { creditoTotal: number; faltaTotal: number; porEtapa: EtapaProducao[] };
  /** referência, N-1, N e N+1 lado a lado */
  comparacao: LinhaComparacao[];
  /** diagnóstico: falta que existe MESMO com equipe de sobra (capacidade física das máquinas) */
  faltaPorLimiteDeMaquina: { total: number; porEtapa: EtapaProducao[] };
  /** diagnóstico: falta ADICIONAL causada por ter menos gente do que o necessário (N-1 vs referência) */
  faltaPorEquipe: { n: number | null; total: number; porEtapa: EtapaProducao[] };
  periodosAnalisados: { total: number; primeiro: { data: string; periodoId: string } | null; ultimo: { data: string; periodoId: string } | null; dias: string[] };
  busca: { metodo: ResultadoBuscaEquipe["metodo"]; monotonico: boolean; rodadas: number; tolerancia: number; equipeVirtualMax: number };
  avisos: AvisoMontagem[];
}

const ID_VIRTUAL = (i: number) => `__virtual_${String(i + 1).padStart(3, "0")}`;

function equipeVirtual(n: number): EstadoBruto["equipeProdutiva"] {
  return Array.from({ length: n }, (_, i) => ({ funcionarioId: ID_VIRTUAL(i), nome: `Virtual ${i + 1}`, ativo: true }));
}

/** Estado da PROGRAMAÇÃO: só o previsto, sem ausências/equidade da equipe real e sem Produção Real. A equipe é injetada por rodada. */
export function estadoDaProgramacao(estado: EstadoBruto): EstadoBruto {
  return {
    ...estado,
    itens: estado.itens.map((i) => {
      const { adicionalPorEtapa: _descartado, ...resto } = i;
      void _descartado;
      return { ...resto, quantidadeAdicional: 0 };
    }),
    ausencias: [],
    historicoEquidade: undefined,
    producaoReal: undefined,
  };
}

/** Maiores equipes que ainda mudam algo: ≤ 1 posto por máquina por período; ×3 deixa o revezamento (no máx. 3 períodos por bloco) sem poder cortar postos. */
export function equipeMaxima(nMaquinas: number): number {
  return Math.max(3, nMaquinas * 3);
}

export function calcularFuncionariosNecessariosDaSemana(estadoBruto: EstadoBruto, agoraMs: number): FuncionariosNecessariosResultado {
  const base = estadoDaProgramacao(estadoBruto);
  const nomeMaq = (id: string) => estadoBruto.nomesMaquinas?.[id] ?? "máquina";
  const nomeProd = (id: string) => (estadoBruto.nomesProdutos?.[id] ?? "produto").trim();

  // máquinas envolvidas = as selecionadas na Previsão (únicas), a mesma contagem que a tela chama de "máquinas envolvidas"
  const usoMaquina = new Map<string, Set<string>>();
  estadoBruto.itens.forEach((i) => Object.values(i.maquinasPorEtapa).flat().forEach((m) => {
    if (!usoMaquina.has(m)) usoMaquina.set(m, new Set());
    usoMaquina.get(m)!.add(nomeProd(i.produtoId));
  }));
  const maquinasEnvolvidas = {
    total: usoMaquina.size,
    maquinas: [...usoMaquina.entries()].map(([id, p]) => ({ id, nome: nomeMaq(id).trim(), produtos: [...p].sort() })).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")),
  };

  const rodar = (n: number) => simularSemana({ ...base, equipeProdutiva: equipeVirtual(n) }, agoraMs);
  const primeira = rodar(1);
  const maquinasNoMotor = new Set(primeira.entrada.pools.flatMap((p) => p.maquinasIds)).size;
  const nMax = equipeMaxima(maquinasNoMotor);

  const produzir = (n: number): RodadaEquipe => {
    const { entrada, resultado } = n === 1 ? primeira : rodar(n);
    const credito: Record<string, number> = {};
    const falta: Record<string, number> = {};
    entrada.pools.forEach((p) => {
      const k = chavePool(p.produtoId, p.etapaId);
      credito[k] = 0;
      falta[k] = Math.max(0, resultado.pecasRestantes[k] ?? 0);
    });
    resultado.alocacoes.forEach((a) => {
      if (a.maquinaId && a.produtoId && a.etapaId) {
        const k = chavePool(a.produtoId, a.etapaId);
        if (k in credito) credito[k] += a.pecas;
      }
    });
    return { n, faltaPorEtapa: falta, creditoPorEtapa: credito };
  };

  const sem = maquinasNoMotor === 0;
  const busca = sem ? null : buscarMenorEquipe({ nMax, produzir });
  const n = busca?.n ?? 0;

  // N+1 e N-1 para a comparação (a busca pode não ter visitado)
  const rodadaDe = (k: number): RodadaEquipe | null => {
    if (!busca || k < 1 || k > nMax) return null;
    return busca.rodadas.find((r) => r.n === k) ?? produzir(k);
  };
  const nomeEtapa = (etapaId: string) => estadoBruto.nomesOperacao[estadoBruto.etapas.find((e) => e.id === etapaId)?.operacaoId ?? ""] ?? "etapa";
  const detalhar = (r: RodadaEquipe, ref?: RodadaEquipe, soAExcedente = false): EtapaProducao[] =>
    Object.keys(r.faltaPorEtapa).sort().map((k) => {
      const [produtoId, etapaId] = k.split("|");
      const falta = soAExcedente && ref ? Math.max(0, r.faltaPorEtapa[k] - (ref.faltaPorEtapa[k] ?? 0)) : r.faltaPorEtapa[k];
      return { produtoId, produto: nomeProd(produtoId), etapaId, operacao: nomeEtapa(etapaId), creditada: r.creditoPorEtapa[k] ?? 0, falta };
    }).filter((e) => !soAExcedente || e.falta > TOLERANCIA_PECAS);

  const ref = busca?.referencia;
  const linha = (r: RodadaEquipe, rotulo: LinhaComparacao["rotulo"]): LinhaComparacao => ({
    n: r.n, rotulo, creditoTotal: soma(r.creditoPorEtapa), faltaTotal: soma(r.faltaPorEtapa),
    perdaVsReferencia: ref ? Math.max(0, soma(ref.creditoPorEtapa) - soma(r.creditoPorEtapa)) : 0,
    igualReferencia: ref ? busca!.iguala[r.n] ?? Object.keys(r.faltaPorEtapa).every((k) => r.faltaPorEtapa[k] <= (ref.faltaPorEtapa[k] ?? 0) + TOLERANCIA_PECAS) : true,
  });
  const comparacao: LinhaComparacao[] = [];
  if (ref && busca) {
    const menos = rodadaDe(n - 1);
    const mais = rodadaDe(n + 1);
    if (menos) comparacao.push(linha(menos, "N-1"));
    const rn = rodadaDe(n);
    if (rn) comparacao.push(linha(rn, "N"));
    if (mais && n + 1 !== busca.nMax) comparacao.push(linha(mais, "N+1"));
    comparacao.push(linha(ref, "equipe de referência"));
  }
  const menosUma = ref ? rodadaDe(n - 1) : null;

  const slots = primeira.entrada.slots.slice(primeira.entrada.aPartirDe);
  return {
    semanaInicio: estadoBruto.semanaInicio,
    funcionariosNecessarios: n,
    maquinasEnvolvidas,
    equipeReferencia: busca?.nMax ?? 0,
    producaoReferencia: ref
      ? { creditoTotal: soma(ref.creditoPorEtapa), faltaTotal: soma(ref.faltaPorEtapa), porEtapa: detalhar(ref) }
      : { creditoTotal: 0, faltaTotal: 0, porEtapa: [] },
    comparacao,
    faltaPorLimiteDeMaquina: ref ? { total: soma(ref.faltaPorEtapa), porEtapa: detalhar(ref).filter((e) => e.falta > TOLERANCIA_PECAS) } : { total: 0, porEtapa: [] },
    faltaPorEquipe: ref && menosUma
      ? (() => { const porEtapa = detalhar(menosUma, ref, true); return { n: menosUma.n, total: porEtapa.reduce((s, e) => s + e.falta, 0), porEtapa }; })()
      : { n: null, total: 0, porEtapa: [] },
    periodosAnalisados: {
      total: slots.length,
      primeiro: slots[0] ? { data: slots[0].data, periodoId: slots[0].periodoId } : null,
      ultimo: slots.length ? { data: slots[slots.length - 1].data, periodoId: slots[slots.length - 1].periodoId } : null,
      dias: estadoBruto.diasProdutivos,
    },
    busca: { metodo: busca?.metodo ?? "binaria", monotonico: busca?.monotonico ?? true, rodadas: busca?.rodadas.length ?? 0, tolerancia: busca?.tolerancia ?? TOLERANCIA_PECAS, equipeVirtualMax: nMax },
    avisos: primeira.montada.avisos,
  };
}
