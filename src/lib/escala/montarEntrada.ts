// Converte o estado bruto do banco na entrada do motor — PURO.
// Regras daqui (sem inventar nada além do que foi decidido):
//  - pool = (produto, etapa); quantidade = soma dos itens previstos do
//    produto; máquinas = união das selecionadas na Previsão para a etapa;
//    etapas sem máquina selecionada NÃO entram (nunca usar máquina fora da
//    Previsão) e são devolvidas como aviso;
//  - metas por período = meta_m1..meta_t3 da etapa;
//  - dia que já tem escala mantém o snapshot de horários do dia;
//  - dia que deixou de ser produtivo: só os períodos já iniciados contam
//    (consumo congelado); o futuro dele é removido;
//  - primeiro slot mutável = primeiro período com início depois de agora
//    (o período em andamento e os concluídos ficam congelados).

import { construirSlotsDeDias, epochMsNoFuso, minutosDoHorario, primeiroSlotFuturo } from "@/features/escala/tempo";
import type { EntradaEscala, PeriodoEscala, PoolEscala } from "@/features/escala/types";
import { calcularLimitesWip } from "@/features/escala/wip";
import type { AvisoMontagem, EstadoBruto } from "./estado";

export interface EntradaMontada {
  entrada: EntradaEscala;
  periodosPorDia: Map<string, PeriodoEscala[]>;
  diasExistentesPorData: Map<string, { versao: number }>;
  removerDias: string[];
  avisos: AvisoMontagem[];
}

export function montarEntradaEscala(estado: EstadoBruto, agoraMs: number): EntradaMontada {
  const avisos: AvisoMontagem[] = [];
  const existentes = new Map(estado.diasExistentes.map((d) => [d.data, d]));
  const produtivos = new Set(estado.diasProdutivos);

  // ---- dias e slots ----
  const periodosPorDia = new Map<string, PeriodoEscala[]>();
  const dias: { data: string; periodos: PeriodoEscala[]; somenteIniciadosAte?: number }[] = [];
  estado.diasProdutivos.forEach((data) => {
    const periodos = existentes.get(data)?.periodosSnapshot ?? estado.periodosAtuais;
    periodosPorDia.set(data, periodos);
    dias.push({ data, periodos });
  });
  const removerDias: string[] = [];
  estado.diasExistentes.forEach((d) => {
    if (produtivos.has(d.data)) return;
    removerDias.push(d.data);
    periodosPorDia.set(d.data, d.periodosSnapshot);
    dias.push({ data: d.data, periodos: d.periodosSnapshot, somenteIniciadosAte: agoraMs });
  });
  const slots = construirSlotsDeDias(dias);
  const aPartirDe = primeiroSlotFuturo(slots, agoraMs);

  // ---- pools (produto, etapa) ----
  const etapasPorProduto = new Map<string, typeof estado.etapas>();
  estado.etapas.forEach((e) => {
    if (!etapasPorProduto.has(e.produtoId)) etapasPorProduto.set(e.produtoId, []);
    etapasPorProduto.get(e.produtoId)!.push(e);
  });
  // Adicional por ETAPA + estoque intermediário (WIP): ativo só pelo parâmetro wip_modo. Desligado = comportamento anterior, idêntico.
  const wipAtivo = estado.parametros?.wipModo === "ativo";
  // item com adicional por etapa: etapa sem valor = 0; item sem ele: o adicional do item (acabado) vale igual para todas as etapas
  const capAdicional = (item: EstadoBruto["itens"][number], etapaId: string) =>
    item.adicionalPorEtapa ? item.adicionalPorEtapa[etapaId] ?? 0 : item.quantidadeAdicional ?? 0;
  const pools = new Map<string, PoolEscala>();
  const semMaquina = new Map<string, PoolEscala>(); // só diagnóstico: etapas sem máquina selecionada
  [...estado.itens]
    .sort((a, b) => (a.produtoId < b.produtoId ? -1 : 1))
    .forEach((item) => {
      (etapasPorProduto.get(item.produtoId) ?? []).forEach((etapa) => {
        const maquinas = item.maquinasPorEtapa[etapa.id] ?? [];
        const chave = `${item.produtoId}|${etapa.id}`;
        if (maquinas.length === 0 && !pools.has(chave)) {
          avisos.push({ tipo: "etapa_sem_maquina", produtoId: item.produtoId, etapaId: etapa.id });
          const ja = semMaquina.get(chave);
          if (ja) ja.quantidade += item.quantidade;
          else {
            semMaquina.set(chave, {
              produtoId: item.produtoId, etapaId: etapa.id, operacaoId: etapa.operacaoId, ordemEtapa: etapa.ordem,
              quantidade: item.quantidade, maquinasIds: [], metas: { ...etapa.metas }, valorUnitario: item.valorUnitario,
              ...(etapa.maquinasCompativeis ? { maquinasCompativeisIds: [...etapa.maquinasCompativeis].sort() } : {}),
            });
          }
          return;
        }
        const atual = pools.get(chave);
        if (!atual) {
          pools.set(chave, {
            produtoId: item.produtoId,
            etapaId: etapa.id,
            operacaoId: etapa.operacaoId,
            ordemEtapa: etapa.ordem,
            quantidade: item.quantidade,
            maquinasIds: [...new Set(maquinas)].sort(),
            metas: { ...etapa.metas },
            valorUnitario: item.valorUnitario,
            ...(wipAtivo ? { adicionalMax: capAdicional(item, etapa.id) } : item.quantidadeAdicional ? { adicionalMax: item.quantidadeAdicional } : {}),
            ...(etapa.maquinasCompativeis ? { maquinasCompativeisIds: [...etapa.maquinasCompativeis].sort() } : {}),
          });
        } else {
          atual.quantidade += item.quantidade;
          if (wipAtivo) atual.adicionalMax = (atual.adicionalMax ?? 0) + capAdicional(item, etapa.id);
          else if (item.quantidadeAdicional) atual.adicionalMax = (atual.adicionalMax ?? 0) + item.quantidadeAdicional;
          atual.maquinasIds = [...new Set([...atual.maquinasIds, ...maquinas])].sort();
          atual.valorUnitario = Math.max(atual.valorUnitario, item.valorUnitario);
        }
      });
    });
  if (pools.size === 0) avisos.push({ tipo: "sem_pools" });

  // ---- equipe produtiva (marcada na Previsão e ainda ativa) ----
  const funcionarios = estado.equipeProdutiva.filter((f) => f.ativo).map((f) => ({ id: f.funcionarioId, nome: f.nome }));
  if (funcionarios.length === 0) avisos.push({ tipo: "sem_funcionarios_produtivos" });

  // ---- ausências -> janelas em minutos do dia (null = dia inteiro) ----
  const ausencias = estado.ausencias.map((a) => ({
    funcionarioId: a.funcionarioId,
    data: a.data,
    inicioMin: a.horarioInicio && a.horarioFim ? minutosDoHorario(a.horarioInicio) : null,
    fimMin: a.horarioInicio && a.horarioFim ? minutosDoHorario(a.horarioFim) : null,
  }));

  // ---- indisponibilidades de recurso (ISO -> ms) ----
  const indisponibilidades = estado.indisponibilidades.map((i) => ({
    maquinaId: i.maquinaId,
    desdeMs: Date.parse(i.desde),
    liberadaEmMs: i.liberadaEm ? Date.parse(i.liberadaEm) : null,
  }));

  // ---- alocações existentes: congeladas (< aPartirDe) e vigentes (>= aPartirDe) ----
  const indicePorSlot = new Map(slots.map((s) => [`${s.data}|${s.periodoId}`, s.indice]));
  const congeladas = estado.alocacoes.filter((a) => (indicePorSlot.get(`${a.data}|${a.periodoId}`) ?? Number.POSITIVE_INFINITY) < aPartirDe);
  // Só as trocas MANUAIS futuras são entrada. As linhas automáticas futuras são saída do recálculo
  // anterior: reaproveitá-las tornaria o plano dependente do CAMINHO de eventos (ver
  // __tests__/reprodutibilidade.test.ts).
  const trocasManuais = estado.alocacoes.filter((a) => a.origem === "manual" && (indicePorSlot.get(`${a.data}|${a.periodoId}`) ?? -1) >= aPartirDe);

  return {
    entrada: {
      slots,
      aPartirDe,
      pools: [...pools.values()],
      funcionarios,
      ausencias,
      maquinasIndisponiveisPrevisao: estado.maquinasIndisponiveisPrevisao,
      maquinasInativas: estado.maquinasInativas,
      indisponibilidades,
      congeladas,
      trocasManuais,
      nomesOperacao: estado.nomesOperacao,
      historicoEquidade: estado.historicoEquidade,
      poolsSemMaquina: [...semMaquina.entries()].filter(([k]) => !pools.has(k)).map(([, p]) => p),
      ...(wipAtivo ? { wip: { limites: calcularLimitesWip([...pools.values()], slots, { wipDiasLimite: estado.parametros?.wipDiasLimite ?? 1 }, estado.proximaSemana ?? null) } } : {}),
    },
    periodosPorDia,
    diasExistentesPorData: new Map(estado.diasExistentes.map((d) => [d.data, { versao: d.versao }])),
    removerDias,
    avisos,
  };
}

// Instante absoluto de um "YYYY-MM-DD HH:MM" no fuso operacional (atalho para testes/UI).
export function instanteLocal(data: string, hhmm: string): number {
  return epochMsNoFuso(data, hhmm);
}
