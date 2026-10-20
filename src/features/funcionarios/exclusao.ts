// Exclusão / unificação CONTROLADA de funcionário (somente administrador) — lado do navegador.
// Tudo que decide está no backend (funções funcionario_resumo / funcionario_exclusao_simular /
// funcionario_exclusao_executar). Aqui só ficam os tipos, os textos e regras de apresentação.

export interface VinculosFuncionario {
  apontamentos: number;
  ocorrencias: number;
  ausencias: number;
  semanas_equipe: number;
  alocacoes: number;
  custos: number;
}

export interface CandidatoUnificacao {
  id: string;
  nome: string;
  ativo: boolean;
  cadastro: string;
  mesmo_nome: boolean;
  apontamentos: number;
  ultima_atividade: string | null;
}

export interface ResumoFuncionario {
  funcionario: { id: string; nome: string; ativo: boolean; cadastro: string; ultima_atividade: string | null };
  vinculos: VinculosFuncionario;
  candidatos: CandidatoUnificacao[];
}

export interface ConflitoSemana {
  semana_inicio: string;
  previsao_id: string;
  produtivo_excluido: boolean;
  produtivo_mantido: boolean;
  produtivo_final: boolean;
  difere: boolean;
}

export interface CustoPlano {
  id: string;
  descricao: string;
  valor: number;
}

export interface PlanoFuncionario {
  id: string;
  nome: string;
  ativo: boolean;
  cadastro: string;
  ultima_atividade: string | null;
  vinculos: Partial<VinculosFuncionario>;
}

export interface PlanoExclusao {
  modo: "exclusao" | "unificacao";
  excluido: PlanoFuncionario;
  mantido: PlanoFuncionario | null;
  transferir: {
    apontamentos: number;
    ocorrencias: number;
    ausencias: number;
    semanas_equipe: number;
    alocacoes_passadas: number;
    custos_copiados: number;
  };
  consolidar: {
    ausencias_identicas: number;
    semanas_equipe: ConflitoSemana[];
    alocacoes_passadas_mesmo_periodo: { data: string; periodo_id: string }[];
    custos_duplicados: CustoPlano[];
  };
  descartar: {
    alocacoes_futuras: { data: string; periodo_id: string }[];
    alocacoes_passadas: { data: string; periodo_id: string }[];
    ausencias: number;
    semanas_equipe: number;
    custos: CustoPlano[];
  };
  impacto_escala: { semanas_recalculadas: { semana_inicio: string }[]; alocacoes_futuras_removidas: number; observacao: string };
  decisoes_custos: Record<string, "copiar" | "descartar">;
  bloqueios: { codigo: string; mensagem: string; detalhe?: unknown }[];
  pendencias: { codigo: string; custo_id?: string; descricao?: string; valor?: number; mensagem: string }[];
  avisos: { codigo: string; mensagem: string }[];
  pode_executar: boolean;
  assinatura: string;
}

// "2026-10-15T10:58:42+00:00" ou "2026-10-20" -> "15/10/2026"
export function formatarData(valor: string | null | undefined): string {
  if (!valor) return "";
  const m = valor.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
}

export function plural(n: number, singular: string, pluralTxt: string): string {
  return `${n} ${n === 1 ? singular : pluralTxt}`;
}

// Linha que diferencia dois cadastros de mesmo nome: nome + data de cadastro + atividade.
export function descreverFuncionario(f: { nome: string; cadastro: string; ultima_atividade: string | null; apontamentos?: number; ativo?: boolean }): string {
  const partes = [f.nome.trim(), `cadastrado em ${formatarData(f.cadastro)}`];
  if (typeof f.apontamentos === "number") partes.push(plural(f.apontamentos, "apontamento", "apontamentos"));
  partes.push(f.ultima_atividade ? `última atividade ${formatarData(f.ultima_atividade)}` : "sem atividade registrada");
  if (f.ativo === false) partes.push("inativo");
  return partes.join(" · ");
}

// Sem unificação NÃO se exclui quem tem apontamentos de produção ou ocorrências de máquina.
export function exigeUnificacao(v: Pick<VinculosFuncionario, "apontamentos" | "ocorrencias">): boolean {
  return v.apontamentos > 0 || v.ocorrencias > 0;
}

export function temHistorico(v: VinculosFuncionario): boolean {
  return v.apontamentos + v.ocorrencias + v.ausencias + v.semanas_equipe + v.alocacoes > 0;
}

export function linhasDeVinculos(v: Partial<VinculosFuncionario>): string[] {
  const l: string[] = [];
  if (v.apontamentos) l.push(plural(v.apontamentos, "apontamento de produção", "apontamentos de produção"));
  if (v.ocorrencias) l.push(plural(v.ocorrencias, "ocorrência de máquina", "ocorrências de máquina"));
  if (v.semanas_equipe) l.push(plural(v.semanas_equipe, "semana na equipe", "semanas na equipe"));
  if (v.ausencias) l.push(plural(v.ausencias, "ausência", "ausências"));
  if (v.alocacoes) l.push(plural(v.alocacoes, "alocação de escala", "alocações de escala"));
  if (v.custos) l.push(plural(v.custos, "custo extra cadastrado", "custos extras cadastrados"));
  return l;
}

// "Histórico que será transferido" (modo unificação)
export function linhasTransferencia(p: PlanoExclusao): string[] {
  const t = p.transferir;
  const l: string[] = [];
  if (t.apontamentos) l.push(plural(t.apontamentos, "apontamento de produção", "apontamentos de produção"));
  if (t.ocorrencias) l.push(plural(t.ocorrencias, "ocorrência de máquina", "ocorrências de máquina"));
  if (t.semanas_equipe) l.push(plural(t.semanas_equipe, "semana na equipe", "semanas na equipe"));
  if (t.ausencias) l.push(plural(t.ausencias, "ausência", "ausências"));
  if (t.alocacoes_passadas) l.push(plural(t.alocacoes_passadas, "alocação de escala já realizada", "alocações de escala já realizadas"));
  if (t.custos_copiados) l.push(plural(t.custos_copiados, "custo extra copiado", "custos extras copiados"));
  return l;
}

// "Consolidado" = o dado existia nos dois cadastros e fica um só
export function linhasConsolidacao(p: PlanoExclusao): string[] {
  const c = p.consolidar;
  const l: string[] = [];
  if (c.semanas_equipe.length) l.push(plural(c.semanas_equipe.length, "semana na equipe em que os dois estavam (produtivo = sim se qualquer um era produtivo)", "semanas na equipe em que os dois estavam (produtivo = sim se qualquer um era produtivo)"));
  if (c.ausencias_identicas) l.push(plural(c.ausencias_identicas, "ausência idêntica (a duplicata é descartada)", "ausências idênticas (as duplicatas são descartadas)"));
  if (c.alocacoes_passadas_mesmo_periodo.length) l.push(plural(c.alocacoes_passadas_mesmo_periodo.length, "alocação passada no mesmo período (prevalece a do funcionário mantido)", "alocações passadas no mesmo período (prevalece a do funcionário mantido)"));
  if (c.custos_duplicados.length) l.push(plural(c.custos_duplicados.length, "custo extra equivalente (duplicata descartada)", "custos extras equivalentes (duplicatas descartadas)"));
  return l;
}

// "Descartado/removido" — com o motivo
export function linhasDescarte(p: PlanoExclusao): string[] {
  const d = p.descartar;
  const l: string[] = [];
  if (d.alocacoes_futuras.length) l.push(plural(d.alocacoes_futuras.length, "alocação futura da Escala (a Escala recalcula)", "alocações futuras da Escala (a Escala recalcula)"));
  if (d.alocacoes_passadas.length) l.push(plural(d.alocacoes_passadas.length, "alocação de escala já realizada", "alocações de escala já realizadas"));
  if (d.ausencias) l.push(plural(d.ausencias, "ausência", "ausências"));
  if (d.semanas_equipe) l.push(plural(d.semanas_equipe, "semana na equipe", "semanas na equipe"));
  d.custos.forEach((c) => l.push(`custo extra "${c.descricao}" (${c.valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })})`));
  return l;
}

// Só dá para confirmar uma simulação sem bloqueios, sem decisões pendentes e que ainda vale
// para o destino escolhido (mudou o destino => simular de novo).
export function podeConfirmar(plano: PlanoExclusao | null, destinoId: string | null, destinoDaSimulacao: string | null): boolean {
  if (!plano || !plano.pode_executar) return false;
  return (destinoId ?? null) === (destinoDaSimulacao ?? null);
}

const MENSAGENS: [RegExp, string][] = [
  [/FUNC_SOMENTE_ADMIN/, "Somente administradores podem excluir ou unificar funcionários."],
  [/FUNC_ASSINATURA_DESATUALIZADA/, "Os dados mudaram desde a simulação. Simule novamente."],
  [/FUNC_BLOQUEADO/, "Existem bloqueios na simulação. Resolva-os e simule novamente."],
  [/FUNC_PENDENCIAS/, "Há custos que ainda precisam de decisão (copiar ou descartar)."],
  [/FUNC_MESMO_REGISTRO/, "Escolha OUTRO funcionário para receber o histórico."],
  [/FUNC_DESTINO_NAO_ENCONTRADO|FUNC_NAO_ENCONTRADO/, "O funcionário não foi encontrado (pode já ter sido excluído). Atualize a página."],
  [/FUNC_REFERENCIAS_RESIDUAIS/, "Ainda existem registros vinculados a este funcionário. Nada foi alterado."],
  [/FUNC_CONFERENCIA_APONTAMENTOS/, "A conferência dos totais de produção falhou. Nada foi alterado."],
];
export function mensagemDeErro(erro: string | null | undefined): string {
  const texto = erro ?? "";
  const achou = MENSAGENS.find(([re]) => re.test(texto));
  return achou ? achou[1] : "Não foi possível concluir. Nada foi alterado.";
}
