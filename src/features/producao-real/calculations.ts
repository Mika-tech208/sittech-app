// Cálculo de Performance mostrado na confirmação do apontamento — única
// fórmula usada nesta etapa (nenhum OEE/disponibilidade/qualidade/custo
// aqui, de propósito). Usa só os snapshots já gravados/retornados pelo
// apontamento (meta_periodo_vigente, duracao_periodo_horas_vigente) mais a
// soma das paradas já vinculadas a ele — nunca recalcula meta ou custo.
//
// Performance = quantidade PRODUZIDA (não a boa) / quantidade teórica no
// tempo produtivo × 100. Sem teto em 100%. Denominador zero -> null (a UI
// mostra "N/A").

export interface DadosPerformance {
  quantidadeProduzida: number;
  metaPeriodoVigente: number;
  duracaoPeriodoHorasVigente: number;
  somaParadasMinutos: number;
}

export function calcularPerformance(dados: DadosPerformance): number | null {
  const duracaoPeriodoMinutos = dados.duracaoPeriodoHorasVigente * 60;
  if (duracaoPeriodoMinutos <= 0) return null;

  const tempoProdutivoMinutos = duracaoPeriodoMinutos - dados.somaParadasMinutos;
  if (tempoProdutivoMinutos <= 0) return null;

  const quantidadeTeorica = dados.metaPeriodoVigente * (tempoProdutivoMinutos / duracaoPeriodoMinutos);
  if (quantidadeTeorica <= 0) return null;

  return (dados.quantidadeProduzida / quantidadeTeorica) * 100;
}

// Traduz as mensagens já amigáveis das RPCs (RAISE EXCEPTION em
// português) pra um texto curto o suficiente pra caber no formulário —
// nunca inventa uma causa que a RPC não relatou. Compartilhada entre
// registrar_apontamento_producao e registrar_sem_producao — as duas usam
// o mesmo texto pra "período já fechado" e pra máquina inativa.
export function mensagemErroRegistrarLancamento(mensagem: string | undefined): string {
  const m = mensagem || "";
  if (m.includes("Já existe um apontamento")) return "Este período já foi fechado para esta máquina.";
  if (m.includes("Máquina") && m.includes("inativa")) return "Esta máquina está inativa.";
  if (m.includes("Produto") && m.includes("inativo")) return "Este produto está inativo.";
  if (m.includes("Funcionário") && m.includes("inativo")) return "Este funcionário está inativo.";
  if (m.includes("elegível")) return "Não foi possível confirmar a etapa deste produto para esta máquina.";
  if (m.includes("Meta não cadastrada")) return "Este produto não tem meta cadastrada para o período atual.";
  if (m.includes("Quantidade de refugo")) return "A quantidade de refugo não pode ser maior que a produzida.";
  if (m.includes("Motivo de parada") && m.includes("não encontrado")) return "Selecione um motivo de parada válido.";
  if (m.includes("Motivo de parada") && m.includes("inativo")) return "Este motivo de parada está inativo.";
  if (m.includes("motivo de parada") && m.includes("obrigatória")) return "Descreva o motivo da parada.";
  if (m.includes("Soma das paradas") && m.includes("ultrapassa")) return "A soma das paradas não pode ultrapassar a duração do período.";
  if (m.includes("Motivo") && m.includes("obrigatório")) return "Selecione um motivo.";
  if (m.includes("Descrição") && m.includes("obrigatória")) return "Descreva o motivo.";
  if (m.includes("Usuário autenticado")) return "Sua sessão expirou — faça login de novo.";
  return "Não foi possível salvar o lançamento. Tente novamente.";
}

// Mesma ideia, pro par abrir_ocorrencia_maquina/encerrar_ocorrencia_maquina
// — mensagens próprias desse domínio (ocorrência/solução), não reaproveita
// mensagemErroRegistrarLancamento pra não confundir "período" com "ocorrência".
export function mensagemErroOcorrencia(mensagem: string | undefined): string {
  const m = mensagem || "";
  if (m.includes("Já existe uma ocorrência aberta")) return "Esta máquina já tem uma ocorrência aberta.";
  if (m.includes("Máquina") && m.includes("inativa")) return "Esta máquina está inativa.";
  if (m.includes("Produto") && m.includes("inativo")) return "Este produto está inativo.";
  if (m.includes("Funcionário") && m.includes("inativo")) return "Este funcionário está inativo.";
  if (m.includes("elegível")) return "Não foi possível confirmar a etapa deste produto para esta máquina.";
  if (m.includes("não é vinculável")) return "Este motivo não pode ser usado para abrir uma ocorrência.";
  if (m.includes("Descrição") && m.includes("obrigatória para abrir")) return "Descreva o que aconteceu.";
  if (m.includes("já foi encerrada")) return "Esta ocorrência já foi encerrada.";
  if (m.includes("Descrição da solução")) return "Descreva o que foi feito para resolver.";
  if (m.includes("não encontrada")) return "Ocorrência não encontrada — a tela pode estar desatualizada.";
  if (m.includes("Usuário autenticado")) return "Sua sessão expirou — faça login de novo.";
  return "Não foi possível salvar. Tente novamente.";
}

// Mesma ideia, pra excluir_apontamento_producao — mensagens próprias
// desse domínio (permissão, apontamento já sumiu), não reaproveita as
// outras duas pra não confundir "excluir" com "salvar"/"abrir".
export function mensagemErroExcluirApontamento(mensagem: string | undefined): string {
  const m = mensagem || "";
  if (m.includes("não tem permissão")) return "Você não tem permissão para excluir apontamentos.";
  if (m.includes("não encontrado")) return "Este apontamento já foi excluído ou não existe mais — a tela pode estar desatualizada.";
  if (m.includes("Usuário autenticado")) return "Sua sessão expirou — faça login de novo.";
  return "Não foi possível excluir o apontamento. Tente novamente.";
}
