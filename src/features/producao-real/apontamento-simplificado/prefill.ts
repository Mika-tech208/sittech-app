// PASSO 1 — pré-preenchimento pela escala: só os postos PROGRAMADOS no período (plano oficial), agrupados por máquina. Funções puras.
import type { AlocacaoPlano, ApontamentoExistente, Catalogo, LinhaApontamento, PlanejadoPosto, VinculoSalvo } from "./tipos";
import { motivoDoBanco } from "./motivos";

const nome = (lista: { id: string; nome: string }[], id: string | null) => lista.find((x) => x.id === id)?.nome.trim() ?? "—";

/** Postos programados do período (uma linha por máquina; o banco garante 1 operador por máquina/período). Ordem: nome da máquina. */
export function postosProgramados(aloc: AlocacaoPlano[], cat: Catalogo): PlanejadoPosto[] {
  const porMaquina = new Map<string, AlocacaoPlano>();
  for (const a of aloc) {
    if (!a.maquinaId || !a.produtoId || !a.etapaId || !a.operacaoId) continue;
    const atual = porMaquina.get(a.maquinaId);
    // defensivo: se houver mais de uma alocação na mesma máquina (não deveria), fica a de maior carga; empate: menor id de funcionário (determinístico)
    if (!atual || a.pecas + (a.pecasAdicional ?? 0) > atual.pecas + (atual.pecasAdicional ?? 0) || (a.pecas + (a.pecasAdicional ?? 0) === atual.pecas + (atual.pecasAdicional ?? 0) && a.funcionarioId < atual.funcionarioId)) porMaquina.set(a.maquinaId, a);
  }
  return [...porMaquina.values()].map((a): PlanejadoPosto => ({
    maquinaId: a.maquinaId as string, maquinaNome: nome(cat.maquinas, a.maquinaId), funcionarioId: a.funcionarioId, funcionarioNome: nome(cat.funcionarios, a.funcionarioId),
    produtoId: a.produtoId as string, produtoNome: nome(cat.produtos, a.produtoId), etapaId: a.etapaId as string, operacaoId: a.operacaoId as string,
    operacaoNome: cat.operacoes[a.operacaoId as string] ?? "—", pecas: a.pecas + (a.pecasAdicional ?? 0),
  })).sort((x, y) => x.maquinaNome.localeCompare(y.maquinaNome, "pt-BR", { numeric: true }));
}

const congelar = <T extends object>(o: T): T => Object.freeze({ ...o });

export function linhaVazia(chave: string): LinhaApontamento {
  return { chave, origem: "POSTO_NAO_PLANEJADO", situacao: "NOVA", planejado: null, real: { maquinaId: null, funcionarioId: null, produtoId: null }, produzido: null, refugo: null, naoProduziu: false, motivo: null, descricao: "", apontamentoId: null };
}

function doApontamento(base: LinhaApontamento, ap: ApontamentoExistente, v: VinculoSalvo | undefined): LinhaApontamento {
  const sem = ap.status === "sem_producao";
  return {
    ...base, situacao: v ? "SALVA_FLUXO" : "EXISTENTE_PAINEL", apontamentoId: ap.id, chave: v?.linhaChave ?? base.chave,
    real: { maquinaId: ap.maquinaId, funcionarioId: ap.funcionarioId, produtoId: ap.produtoId },
    produzido: sem ? null : ap.produzido, refugo: sem ? null : ap.refugo, naoProduziu: sem,
    motivo: sem ? (v?.motivo ?? motivoDoBanco(ap.motivoSemProducao)) : null, descricao: sem ? (v ? v.descricaoInformada : (ap.descricaoSemProducao ?? "")) : "",
  };
}

/**
 * Linhas iniciais da tela: 1 por posto programado (pré-preenchida com o plano) + 1 por apontamento já existente que não corresponde a posto programado (extras).
 * Apontamento já gravado por este fluxo volta editável (SALVA_FLUXO); o lançado no painel volta bloqueado (EXISTENTE_PAINEL).
 * `novaChave` gera a chave de cada linha nova (injetável para teste).
 */
export function linhasIniciais(postos: PlanejadoPosto[], existentes: ApontamentoExistente[], vinculos: VinculoSalvo[], novaChave: () => string): LinhaApontamento[] {
  const usados = new Set<string>();
  const vinc = new Map(vinculos.map((v) => [v.apontamentoId, v]));
  const linhas: LinhaApontamento[] = postos.map((p) => {
    const base: LinhaApontamento = {
      chave: novaChave(), origem: "PROGRAMADO", situacao: "NOVA", planejado: congelar(p),
      real: { maquinaId: p.maquinaId, funcionarioId: p.funcionarioId, produtoId: p.produtoId }, produzido: null, refugo: null, naoProduziu: false, motivo: null, descricao: "", apontamentoId: null,
    };
    // 1) gravado por este fluxo para ESTE posto programado (a máquina real pode ter sido trocada)
    const v = vinculos.find((x) => x.maquinaPlanejadaId === p.maquinaId);
    const apV = v ? existentes.find((a) => a.id === v.apontamentoId) : undefined;
    if (apV) { usados.add(apV.id); return doApontamento(base, apV, v); }
    // 2) lançado no painel na própria máquina programada
    const apP = existentes.find((a) => a.maquinaId === p.maquinaId && !usados.has(a.id) && !vinc.has(a.id));
    if (apP) { usados.add(apP.id); return doApontamento(base, apP, undefined); }
    return base;
  });
  // extras: apontamentos que sobraram
  for (const ap of existentes) {
    if (usados.has(ap.id)) continue;
    const v = vinc.get(ap.id);
    linhas.push(doApontamento({ ...linhaVazia(novaChave()), origem: "POSTO_NAO_PLANEJADO" }, ap, v));
  }
  return linhas;
}
