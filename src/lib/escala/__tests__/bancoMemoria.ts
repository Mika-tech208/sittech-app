// Banco em memória para os testes de reprodutibilidade do recálculo (não é um arquivo de teste).
// Reproduz o contrato real: o orquestrador (processarSemana) lê o estado, roda o motor e o
// `aplicar` troca SÓ os períodos futuros (como escala_aplicar_recalculo faz no Postgres).
// O teste muda as ENTRADAS (ausências, recursos, equipe, previsão…) e dispara recálculos,
// exatamente como o fluxo real de eventos.

import { PERIODOS_REAIS } from "@/features/escala/__tests__/helpers";
import type { AlocacaoEscala } from "@/features/escala/types";
import type { EstadoBruto, PayloadAplicacao } from "../estado";
import { montarEntradaEscala } from "../montarEntrada";
import { processarSemana, type EscalaIO } from "../processar";

export type AlocacaoComOrigem = AlocacaoEscala & { origem?: "auto" | "manual" };

const METAS = (a: number, b: number) => ({ m1: a, m2: b, m3: a, t1: b, t2: a, t3: b });

// Semana com equipe, produtos de 1–2 etapas e máquinas compartilhadas: o suficiente para haver
// folga, rotação, equidade e disputa por máquina (onde os empates existem).
export function estadoDeTeste(semanaInicio: string, dias: string[], opcoes: { pessoas?: number } = {}): EstadoBruto {
  const n = opcoes.pessoas ?? 10;
  return {
    previsaoId: "prev1",
    semanaInicio,
    diasProdutivos: dias,
    periodosAtuais: PERIODOS_REAIS,
    diasExistentes: [],
    equipeProdutiva: Array.from({ length: n }, (_, i) => ({ funcionarioId: `f${String(i + 1).padStart(2, "0")}`, ativo: true })),
    itens: [
      { produtoId: "pA", quantidade: 5200, quantidadeAdicional: 0, valorUnitario: 3, maquinasPorEtapa: { eA1: ["m1", "m2"], eA2: ["m5"] } },
      { produtoId: "pB", quantidade: 4300, quantidadeAdicional: 0, valorUnitario: 2, maquinasPorEtapa: { eB1: ["m2", "m3"], eB2: ["m5", "m6"] } },
      { produtoId: "pC", quantidade: 2600, quantidadeAdicional: 0, valorUnitario: 5, maquinasPorEtapa: { eC1: ["m4", "m7"] } },
      { produtoId: "pD", quantidade: 3100, quantidadeAdicional: 0, valorUnitario: 1.5, maquinasPorEtapa: { eD1: ["m3", "m8"], eD2: ["m6"] } },
    ],
    etapas: [
      { id: "eA1", produtoId: "pA", operacaoId: "opRosca", ordem: 1, metas: METAS(110, 95) },
      { id: "eA2", produtoId: "pA", operacaoId: "opEmbal", ordem: 2, metas: METAS(90, 100) },
      { id: "eB1", produtoId: "pB", operacaoId: "opRosca", ordem: 1, metas: METAS(80, 85) },
      { id: "eB2", produtoId: "pB", operacaoId: "opMont", ordem: 2, metas: METAS(70, 75) },
      { id: "eC1", produtoId: "pC", operacaoId: "opEtiq", ordem: 1, metas: METAS(60, 65) },
      { id: "eD1", produtoId: "pD", operacaoId: "opMont", ordem: 1, metas: METAS(120, 100) },
      { id: "eD2", produtoId: "pD", operacaoId: "opEmbal", ordem: 2, metas: METAS(100, 110) },
    ],
    maquinasIndisponiveisPrevisao: [],
    maquinasInativas: [],
    ausencias: [],
    indisponibilidades: [],
    alocacoes: [],
    nomesOperacao: { opRosca: "Rosquear", opEmbal: "Embalar", opMont: "Montar", opEtiq: "Etiquetar" },
  };
}

export class Mundo {
  entradas: EstadoBruto;
  alocacoes: AlocacaoComOrigem[] = [];
  dias = new Map<string, { versao: number; snapshot: typeof PERIODOS_REAIS }>();
  recalculos = 0;

  constructor(entradas: EstadoBruto) {
    this.entradas = entradas;
  }

  // Edita as entradas canônicas (clone raso por mutação controlada pelos testes).
  editar(f: (e: EstadoBruto) => void) {
    f(this.entradas);
  }

  private io(): EscalaIO {
    return {
      carregarEstado: async () => ({
        ...this.entradas,
        diasExistentes: [...this.dias].map(([data, d]) => ({ data, versao: d.versao, periodosSnapshot: d.snapshot })),
        alocacoes: this.alocacoes.map((a) => ({ ...a })),
      }),
      aplicar: async (p: PayloadAplicacao) => {
        const ordem = (periodoId: string, data: string) => (this.dias.get(data)?.snapshot ?? PERIODOS_REAIS).findIndex((x) => x.id === periodoId);
        p.dias.forEach((d) => {
          if (!this.dias.has(d.data)) this.dias.set(d.data, { versao: 0, snapshot: d.periodos_snapshot });
        });
        const corte = ordem(p.aPartirDePeriodo, p.aPartirDeData);
        this.alocacoes = this.alocacoes.filter((a) => !(a.data > p.aPartirDeData || (a.data === p.aPartirDeData && ordem(a.periodoId, a.data) >= corte)));
        p.alocacoes.forEach((a) => this.alocacoes.push({ ...a, origem: (a as AlocacaoComOrigem).origem ?? "auto" }));
        const versoes: Record<string, number> = {};
        p.dias.forEach((d) => {
          const dia = this.dias.get(d.data)!;
          dia.versao += 1;
          versoes[d.data] = dia.versao;
        });
        return { versoes };
      },
    };
  }

  // Um recálculo no instante `agoraMs` (a 1ª chamada, com criarSeNaoExiste, gera a semana).
  async recalcular(agoraMs: number, criar = false) {
    this.recalculos++;
    return processarSemana(this.io(), { agoraMs, criarSeNaoExiste: criar });
  }

  // Troca manual (como a RPC escala_trocar_alocacoes): só o que ainda não começou.
  trocarManual(data: string, periodoId: string, a: string, b: string) {
    const la = this.alocacoes.find((x) => x.data === data && x.periodoId === periodoId && x.funcionarioId === a)!;
    const lb = this.alocacoes.find((x) => x.data === data && x.periodoId === periodoId && x.funcionarioId === b)!;
    const campos = ["maquinaId", "produtoId", "etapaId", "operacaoId", "pecas", "pecasAdicional", "motivoSemPosto", "excecaoRevezamento", "motivoExcecao"] as const;
    campos.forEach((c) => {
      const t = (la as unknown as Record<string, unknown>)[c];
      (la as unknown as Record<string, unknown>)[c] = (lb as unknown as Record<string, unknown>)[c];
      (lb as unknown as Record<string, unknown>)[c] = t;
    });
    la.origem = "manual";
    lb.origem = "manual";
  }

  // Linhas ainda não iniciadas em `agoraMs`, em ordem canônica (o que o teste compara).
  futuras(agoraMs: number): AlocacaoComOrigem[] {
    const { entrada } = montarEntradaEscala(
      { ...this.entradas, diasExistentes: [...this.dias].map(([data, d]) => ({ data, versao: d.versao, periodosSnapshot: d.snapshot })), alocacoes: [] },
      agoraMs
    );
    const indice = new Map(entrada.slots.map((s) => [`${s.data}|${s.periodoId}`, s.indice]));
    return this.alocacoes
      .filter((a) => (indice.get(`${a.data}|${a.periodoId}`) ?? -1) >= entrada.aPartirDe)
      .sort((x, y) => (x.data + x.periodoId + x.funcionarioId < y.data + y.periodoId + y.funcionarioId ? -1 : 1));
  }

  static assinatura(linhas: AlocacaoComOrigem[], incluirOrigem = false): string {
    return JSON.stringify(
      linhas.map((a) => [a.data, a.periodoId, a.funcionarioId, a.maquinaId, a.produtoId, a.etapaId, a.operacaoId, a.pecas, a.pecasAdicional ?? 0, a.motivoSemPosto, a.excecaoRevezamento, ...(incluirOrigem ? [a.origem ?? "auto"] : [])])
    );
  }
}
