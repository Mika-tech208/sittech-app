// RELATÓRIOS SEMANAIS DA ESCALA — tipos. Funções puras (sem IO): o servidor lê os insumos (RPC escala_relatorio_fontes), monta o CONTEÚDO, congela o snapshot e só então
// renderiza o PDF. O conteúdo é o que o hash cobre.

export type TipoRelatorio = "planejada" | "executada";
export type StatusRelatorio = "parcial" | "final";

// ---- insumos (como a RPC devolve) ----
export interface PeriodoBruto { id: string; nome: string; inicio: string; fim: string }
export interface OficialBruto { data: string; periodoId: string; funcionarioId: string; maquinaId: string | null; produtoId: string | null; operacaoId: string | null; pecas: number; origem: string; motivoSemPosto: string | null; excecaoRevezamento: boolean }
export interface ApontamentoBruto { id: string; data: string; periodoId: string; funcionarioId: string | null; maquinaId: string | null; produtoId: string | null; operacaoId: string | null; produzido: number; refugo: number; status: string; motivo: string | null }
export interface AusenciaBruta { funcionarioId: string; data: string; tipo: string; inicio: string | null; fim: string | null; emAberto: boolean }
export interface SituacaoBruta { funcionarioId: string; acao: string; efetivoEm: string; registradoEm: string; ativoAntes: boolean; ativoDepois: boolean }

export interface FontesRelatorio {
  agoraBanco: string;
  comoDe?: string | null;                                 // instante da reconstrução (fechamento lógico); ausente/nulo = estado atual
  reconstrucao?: { oficial: "versao" | "atual" };       // como o plano oficial foi obtido na reconstrução
  semanaInicio: string;
  previsaoId: string;
  diasProdutivos: string[];
  periodosPorDia: Record<string, PeriodoBruto[]>;
  periodosPadrao: PeriodoBruto[];
  equipe: string[];
  oficial: OficialBruto[];
  apontamentos: ApontamentoBruto[];
  ausencias: AusenciaBruta[];
  ajustesManuais: { em: string; payload: Record<string, unknown> }[];
  planoVersao: { id: string; hashPlano: string; validoDesde: string } | null;
  situacaoFuncionarios: SituacaoBruta[];
  funcionarios: { id: string; nome: string; ativo: boolean }[];
  maquinas: Record<string, string>;
  produtos: Record<string, string>;
  operacoes: Record<string, string>;
}

// ---- conteúdo (snapshot) ----
export type FonteCelula = "APONTAMENTO" | "AUSENCIA" | "OFICIAL_SEM_APONTAMENTO" | "SEM_POSTO_OFICIAL" | "NAO_COMPROVADO" | "SEM_EVIDENCIA" | "PLANEJADO" | "PLANEJADO_SEM_POSTO";

export interface Posto { maquina: string; operacao: string; operacaoId: string; produto: string; boas: number | null }
export interface Celula {
  fonte: FonteCelula;
  postos: Posto[]; // apontamentos (ou o posto oficial, nas fontes de escala)
  detalhe: string | null;
  planejado: Posto | null; // só nas células APONTAMENTO: o posto oficial do período (quando houver)
  planejadoRotulo: string | null; // "sem posto oficial: …" / "sem linha oficial"
  divergente: boolean; // "Planejado diferente do realizado"
}

export interface ViolacaoRevezamento { funcionario: string; data: string; de: string; para: string; operacao: string; maquinas: string }
export type EstadoRevezamento = "SIM" | "SIM_COM_RESSALVAS" | "NAO";

export interface ResumoRevezamento {
  estado: EstadoRevezamento;
  verificadas: number; // transições com os dois períodos comprovados por apontamento
  naoAplicaveis: number; // há ausência/sem posto no par
  naoVerificaveis: number; // falta evidência suficiente
  violacoes: ViolacaoRevezamento[];
  frase: string;
}

export interface CoberturaEvidencia {
  esperados: number;
  porApontamento: number;
  porAusencia: number;
  oficialSemApontamento: number;
  naoComprovado: number;
  semEvidencia: number;
  foraDoEsperado: number; // apontamento/ausência de quem não era esperado no período (mostrado, não conta na cobertura)
  numerador: number; // porApontamento + porAusencia
  percentualDecimos: number | null; // (numerador/esperados) em décimos de ponto percentual, arredondado meio-para-cima, em aritmética inteira; null se esperados = 0
  percentualTexto: string; // "93,8%"
}

export interface DiaConteudo { data: string; periodos: { id: string; nome: string; inicio: string; fim: string; considerado: boolean }[] }
export interface FuncionarioConteudo { id: string; nome: string; dias: { data: string; celulas: Record<string, Celula | null> }[] }

export interface ConteudoRelatorio {
  schemaVersao: 1;
  tipo: TipoRelatorio;
  codigo: string;
  versao: number;
  status: StatusRelatorio;
  empresa: string;
  titulo: string;
  semana: { inicio: string; fim: string; texto: string };
  geradoEm: string;
  geradoEmTexto: string;
  geradoPor: { id: string; nome: string };
  consolidadoAte: string;
  consolidadoAteTexto: string;
  elegivelFinalEm: string; // = fechamento lógico
  elegivelFinalEmTexto: string;
  toleranciaApontamentoMin: number;
  fechamentoAutomatico: boolean; // finalizado pelo sistema no fechamento lógico (sexta/sábado 18:00)
  urlVerificacao: string;
  fontes: { planoVersao: { id: string; hashPlano: string; validoDesde: string } | null; digest: string; qtdApontamentos: number; qtdAusencias: number; qtdOficial: number; qtdAjustesManuais: number; avisos: string[] };
  dias: DiaConteudo[];
  funcionarios: FuncionarioConteudo[];
  semProducao: { data: string; periodoId: string; maquina: string; motivo: string }[];
  ausencias: { funcionario: string; data: string; tipo: string; janela: string }[];
  resumo: { revezamento: ResumoRevezamento; cobertura: CoberturaEvidencia | null; divergencias: number; inconsistencias: number };
}
