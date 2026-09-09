// Sittech Intelligence V1 — busca de dados server-side. Réplica FIEL do
// mapeamento de linha já usado em src/hooks/useIndicadoresJanelaHistorica.ts,
// usePrevisoes.ts, useProdutos.ts, useMaquinas.ts, useCadastrosBase.ts e
// useOcorrenciasAbertas.ts (o mesmo padrão snake_case->camelCase já
// duplicado 3x nesses hooks — nunca é cálculo, só conversão de nome de
// coluna). Precisa existir aqui porque hooks React não rodam em Route
// Handler — NENHUMA fórmula de negócio é reescrita, só o fetch. Todo
// acesso passa pelo cliente `supabase` recebido como parâmetro (sempre o
// `supabaseAsUser` de auth.ts — nunca um client admin).

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ApontamentoIndicador, StatusApontamento } from "@/features/producao-real/indicadores/calculations";
import type { ParadaComContexto } from "@/features/producao-real/paradas/calculations";
import type { Produto, Maquina, Periodo, PeriodoComDuracao, Previsao, PrevisaoItem, Prioridade } from "@/types/domain";
import { calcularPeriodosComDuracao } from "@/lib/calculations/periodos";
import { toNumber } from "@/lib/format";

// ---------------------------------------------------------------------
// Apontamentos + Paradas — obter_indicadores_producao/obter_paradas_producao
// (mesmas 2 RPCs de sempre; SECURITY DEFINER, gate has_permissao('producao_real_historico')
// já embutido nelas — se o usuário não tiver a permissão, o Supabase
// devolve erro, propagado pelo `error` abaixo).
// ---------------------------------------------------------------------
interface ApontamentoIndicadorRow {
  apontamento_id: string; data: string; periodo_id: string; periodo_nome: string;
  status: StatusApontamento; motivo_sem_producao: string | null;
  produto_id: string | null; produto_nome: string | null;
  maquina_id: string; maquina_nome: string;
  operacao_id: string | null; operacao_nome: string | null;
  funcionario_id: string | null; funcionario_nome: string | null;
  etapa_id: string | null; etapa_ordem: number | null; is_ultima_etapa: boolean | null;
  quantidade_produzida: number; quantidade_refugo: number;
  meta_periodo_vigente: number | null; duracao_periodo_horas_vigente: number; minutos_parados: number;
  custo_hora_operacao_vigente: number | null; custo_operacional_periodo_vigente: number | null;
  custo_unitario_referencia_periodo_vigente: number | null; produto_valor_unitario: number | null;
  etapa_maquinas_elegiveis: number;
}

interface ParadaIndicadorRow {
  parada_id: string; apontamento_id: string; data: string; periodo_id: string; minutos: number;
  motivo_id: string; motivo_nome: string; motivo_categoria: string; origem: "manual" | "ocorrencia";
  produto_id: string | null; produto_nome: string | null; maquina_id: string; maquina_nome: string;
  operacao_id: string | null; operacao_nome: string | null; funcionario_id: string | null; funcionario_nome: string | null;
  custo_hora_operacao_vigente: number | null; meta_periodo_vigente: number | null; duracao_periodo_horas_vigente: number | null;
  descricao_problema: string | null; descricao_solucao: string | null;
  ocorrencia_id: string | null; ocorrencia_aberta_em: string | null; ocorrencia_encerrada_em: string | null;
}

function linhaParaApontamento(r: ApontamentoIndicadorRow): ApontamentoIndicador {
  return {
    apontamentoId: r.apontamento_id, data: r.data, periodoId: r.periodo_id, periodoNome: r.periodo_nome,
    status: r.status, motivoSemProducao: r.motivo_sem_producao,
    produtoId: r.produto_id, produtoNome: r.produto_nome,
    maquinaId: r.maquina_id, maquinaNome: r.maquina_nome,
    operacaoId: r.operacao_id, operacaoNome: r.operacao_nome,
    funcionarioId: r.funcionario_id, funcionarioNome: r.funcionario_nome,
    etapaId: r.etapa_id, etapaOrdem: r.etapa_ordem, isUltimaEtapa: r.is_ultima_etapa,
    quantidadeProduzida: Number(r.quantidade_produzida), quantidadeRefugo: Number(r.quantidade_refugo),
    metaPeriodoVigente: r.meta_periodo_vigente === null ? null : Number(r.meta_periodo_vigente),
    duracaoPeriodoHorasVigente: Number(r.duracao_periodo_horas_vigente),
    minutosParados: Number(r.minutos_parados),
    custoHoraOperacaoVigente: r.custo_hora_operacao_vigente === null ? null : Number(r.custo_hora_operacao_vigente),
    custoOperacionalPeriodoVigente: r.custo_operacional_periodo_vigente === null ? null : Number(r.custo_operacional_periodo_vigente),
    custoUnitarioReferenciaPeriodoVigente: r.custo_unitario_referencia_periodo_vigente === null ? null : Number(r.custo_unitario_referencia_periodo_vigente),
    produtoValorUnitario: r.produto_valor_unitario === null ? null : Number(r.produto_valor_unitario),
    etapaMaquinasElegiveis: Number(r.etapa_maquinas_elegiveis),
  };
}

function linhaParaParada(r: ParadaIndicadorRow): ParadaComContexto {
  return {
    paradaId: r.parada_id, apontamentoId: r.apontamento_id, data: r.data, periodoId: r.periodo_id,
    minutos: Number(r.minutos), motivoId: r.motivo_id, motivoNome: r.motivo_nome, motivoCategoria: r.motivo_categoria,
    origem: r.origem, produtoId: r.produto_id, produtoNome: r.produto_nome,
    maquinaId: r.maquina_id, maquinaNome: r.maquina_nome, operacaoId: r.operacao_id, operacaoNome: r.operacao_nome,
    funcionarioId: r.funcionario_id, funcionarioNome: r.funcionario_nome,
    custoHoraOperacaoVigente: r.custo_hora_operacao_vigente === null ? null : Number(r.custo_hora_operacao_vigente),
    metaPeriodoVigente: r.meta_periodo_vigente === null ? null : Number(r.meta_periodo_vigente),
    duracaoPeriodoHorasVigente: r.duracao_periodo_horas_vigente === null ? null : Number(r.duracao_periodo_horas_vigente),
    descricaoProblema: r.descricao_problema,
    descricaoSolucao: r.descricao_solucao,
    ocorrenciaId: r.ocorrencia_id,
    ocorrenciaAbertaEm: r.ocorrencia_aberta_em,
    ocorrenciaEncerradaEm: r.ocorrencia_encerrada_em,
  };
}

export interface ErroConsulta {
  erro: string;
}

export async function buscarApontamentosEParadas(
  supabase: SupabaseClient,
  dataInicial: string,
  dataFinal: string
): Promise<{ apontamentos: ApontamentoIndicador[]; paradas: ParadaComContexto[] } | ErroConsulta> {
  const params = { p_data_inicial: dataInicial, p_data_final: dataFinal, p_produto_id: null, p_maquina_id: null, p_operacao_id: null, p_funcionario_id: null, p_periodo_id: null };
  const [apontamentosResp, paradasResp] = await Promise.all([
    supabase.rpc("obter_indicadores_producao", params),
    supabase.rpc("obter_paradas_producao", params),
  ]);
  if (apontamentosResp.error || paradasResp.error) {
    return { erro: apontamentosResp.error?.message || paradasResp.error?.message || "Falha ao consultar produção/paradas." };
  }
  return {
    apontamentos: ((apontamentosResp.data || []) as ApontamentoIndicadorRow[]).map(linhaParaApontamento),
    paradas: ((paradasResp.data || []) as ParadaIndicadorRow[]).map(linhaParaParada),
  };
}

// ---------------------------------------------------------------------
// Produtos + roteiro (réplica de useProdutos.ts, só leitura).
// ---------------------------------------------------------------------
interface RoteiroEtapaRow {
  id: string; ordem: number;
  meta_m1: number; meta_m2: number; meta_m3: number; meta_t1: number; meta_t2: number; meta_t3: number;
  operacoes: { nome: string } | { nome: string }[] | null;
  roteiro_etapa_maquinas: { maquina_id: string }[] | null;
}
interface ProdutoRow {
  id: string; nome: string; referencia: string | null; valor_unitario: number; ativo: boolean; prioridade: Prioridade;
  roteiro_etapas: RoteiroEtapaRow[] | null;
}

function primeiro<T>(v: T | T[] | null): T | null {
  if (v === null) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

const PRODUTO_COM_ROTEIRO_SELECT = `
  id, nome, referencia, valor_unitario, ativo, prioridade,
  roteiro_etapas(
    id, ordem, meta_m1, meta_m2, meta_m3, meta_t1, meta_t2, meta_t3,
    operacoes(nome),
    roteiro_etapa_maquinas(maquina_id)
  )
`;

function linhaParaProduto(p: ProdutoRow): Produto {
  return {
    id: p.id, nome: p.nome, referencia: p.referencia || "", valorUnitario: Number(p.valor_unitario),
    ativo: p.ativo, prioridade: p.prioridade,
    roteiro: (p.roteiro_etapas || [])
      .slice()
      .sort((a, b) => a.ordem - b.ordem)
      .map((e) => ({
        id: e.id,
        operacao: primeiro(e.operacoes)?.nome || "",
        metas: { m1: Number(e.meta_m1), m2: Number(e.meta_m2), m3: Number(e.meta_m3), t1: Number(e.meta_t1), t2: Number(e.meta_t2), t3: Number(e.meta_t3) },
        maquinasIds: (e.roteiro_etapa_maquinas || []).map((m) => m.maquina_id),
      })),
  };
}

export async function buscarProdutos(supabase: SupabaseClient): Promise<Produto[] | ErroConsulta> {
  const { data, error } = await supabase.from("produtos").select(PRODUTO_COM_ROTEIRO_SELECT).eq("ativo", true);
  if (error) return { erro: error.message };
  return ((data || []) as unknown as ProdutoRow[]).map(linhaParaProduto);
}

// ---------------------------------------------------------------------
// Máquinas (réplica de useMaquinas.ts).
// ---------------------------------------------------------------------
interface MaquinaRow {
  id: string; nome: string; ativo: boolean;
  operacoes: { nome: string } | { nome: string }[] | null;
}

export async function buscarMaquinas(supabase: SupabaseClient): Promise<Maquina[] | ErroConsulta> {
  const { data, error } = await supabase.from("maquinas").select("id, nome, ativo, operacoes(nome)").eq("ativo", true);
  if (error) return { erro: error.message };
  return ((data || []) as unknown as MaquinaRow[]).map((m) => ({ id: m.id, nome: m.nome, ativo: m.ativo, operacao: primeiro(m.operacoes)?.nome || "" }));
}

// ---------------------------------------------------------------------
// Períodos + dias úteis (réplica de useCadastrosBase.ts).
// ---------------------------------------------------------------------
export async function buscarPeriodosEDiasUteis(supabase: SupabaseClient): Promise<{ periodosComDuracao: PeriodoComDuracao[]; diasUteisSemana: number } | ErroConsulta> {
  const [periodosResp, cfgResp] = await Promise.all([
    supabase.from("periodos").select("id, nome, inicio, fim").order("id"),
    supabase.from("configuracoes_empresa").select("dias_uteis_semana").limit(1).maybeSingle(),
  ]);
  if (periodosResp.error) return { erro: periodosResp.error.message };
  const periodos = (periodosResp.data || []) as Periodo[];
  const diasUteisSemana = toNumber(String(cfgResp.data?.dias_uteis_semana ?? "5"));
  return { periodosComDuracao: calcularPeriodosComDuracao(periodos), diasUteisSemana };
}

// ---------------------------------------------------------------------
// Previsão de UMA semana (réplica de usePrevisoes.ts, só leitura,
// filtrada pela semana pedida — a UI carrega todas as semanas pro
// seletor, Intelligence só precisa de uma por vez).
// ---------------------------------------------------------------------
type TipoItemPrevisao = "previsto" | "realizado";
interface PrevisaoItemRow {
  id: string; tipo: TipoItemPrevisao; produto_id: string; produto_nome: string; valor_unitario: number; quantidade: number;
  previsao_item_maquinas: { etapa_id: string; maquina_id: string }[] | null;
}
interface PrevisaoRow {
  id: string; semana_inicio: string;
  previsao_itens: PrevisaoItemRow[] | null;
  previsao_maquinas_indisponiveis: { maquina_id: string }[] | null;
}
const PREVISAO_SELECT = `
  id, semana_inicio,
  previsao_itens(id, tipo, produto_id, produto_nome, valor_unitario, quantidade, previsao_item_maquinas(etapa_id, maquina_id)),
  previsao_maquinas_indisponiveis(maquina_id)
`;

function agruparMaquinasPorEtapa(linhas: { etapa_id: string; maquina_id: string }[] | null): Record<string, string[]> {
  const mapa: Record<string, string[]> = {};
  (linhas || []).forEach((l) => {
    if (!mapa[l.etapa_id]) mapa[l.etapa_id] = [];
    mapa[l.etapa_id].push(l.maquina_id);
  });
  return mapa;
}
function linhaParaItemPrevisao(i: PrevisaoItemRow): PrevisaoItem {
  return { id: i.id, produtoId: i.produto_id, produtoNome: i.produto_nome, valorUnitario: Number(i.valor_unitario), quantidade: Number(i.quantidade), maquinasPorEtapa: agruparMaquinasPorEtapa(i.previsao_item_maquinas) };
}
function linhaParaPrevisao(p: PrevisaoRow): Previsao {
  const linhas = p.previsao_itens || [];
  return {
    semanaInicio: p.semana_inicio,
    itens: linhas.filter((i) => i.tipo === "previsto").map(linhaParaItemPrevisao),
    itensRealizados: linhas.filter((i) => i.tipo === "realizado").map(linhaParaItemPrevisao),
    maquinasIndisponiveis: (p.previsao_maquinas_indisponiveis || []).map((m) => m.maquina_id),
  };
}

export async function buscarPrevisaoSemana(supabase: SupabaseClient, semanaInicioISO: string): Promise<Previsao | null | ErroConsulta> {
  const { data, error } = await supabase.from("previsoes").select(PREVISAO_SELECT).eq("semana_inicio", semanaInicioISO).maybeSingle();
  if (error) return { erro: error.message };
  if (!data) return null;
  return linhaParaPrevisao(data as unknown as PrevisaoRow);
}

// ---------------------------------------------------------------------
// Ocorrências abertas (réplica de useOcorrenciasAbertas.ts — mesma
// tabela, mesmo select, sem RPC).
// ---------------------------------------------------------------------
export interface OcorrenciaAbertaResumo {
  id: string; maquinaId: string; maquinaNome: string; motivoNome: string; descricao: string; abertaEm: string;
}
interface OcorrenciaAbertaRow {
  id: string; maquina_id: string; descricao: string; aberta_em: string;
  maquinas: { nome: string } | { nome: string }[] | null;
  motivos_parada: { nome: string } | { nome: string }[] | null;
}

export async function buscarOcorrenciasAbertas(supabase: SupabaseClient): Promise<OcorrenciaAbertaResumo[] | ErroConsulta> {
  const { data, error } = await supabase
    .from("ocorrencias_maquina")
    .select("id, maquina_id, descricao, aberta_em, maquinas(nome), motivos_parada(nome)")
    .is("encerrada_em", null)
    .returns<OcorrenciaAbertaRow[]>();
  if (error) return { erro: error.message };
  return (data || []).map((o) => ({
    id: o.id, maquinaId: o.maquina_id, maquinaNome: primeiro(o.maquinas)?.nome || "Máquina",
    motivoNome: primeiro(o.motivos_parada)?.nome || "Motivo não informado", descricao: o.descricao, abertaEm: o.aberta_em,
  }));
}

export function ehErroConsulta<T>(v: T | ErroConsulta): v is ErroConsulta {
  return typeof v === "object" && v !== null && "erro" in v;
}
