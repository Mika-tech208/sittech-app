// REGRA "NUNCA DEIXAR PESSOA PARADA" (PURA). Uma pessoa-período SEM posto só é aceitável com um destes motivos AUDITÁVEIS; senão deve receber trabalho útil
// (semana atual primeiro; se não aumenta o resultado atual, antecipação da próxima semana dentro do TETO). Nenhuma produtividade individual: o que se avalia é o POSTO.
export type MotivoSemPosto = "nenhuma_maquina_permitida" | "nenhum_material" | "nenhuma_demanda_atual_nem_futura" | "hard_constraints_impedem";

export interface OpcaoDePosto {
  /** identificador do posto (máquina + pool) */
  posto: string;
  produtoId: string;
  etapaId: string;
  maquinaId: string;
  /** posto livre e disponível no período (Previsão, paradas) */
  maquinaPermitida: boolean;
  /** há material/WIP (ou a etapa é a inicial) para produzir */
  temMaterial: boolean;
  /** R$ da semana atual (≥ 0 se ocupar o posto é neutro/positivo) */
  valorAtual: number;
  /** R$ futuro esperado (próxima semana), já limitado pelo teto e pela demanda futura */
  valorFuturo: number;
  /** pessoa pode ocupar sem violar hard constraints (revezamento por bloco, ausência, parada) */
  hardOk: boolean;
  /** ALÍVIO de capacidade da próxima semana (posto-períodos que deixam de ser necessários), já limitado pelo teto e pela demanda futura. Usado só quando o valor futuro em R$ é zero. */
  alivioPostoPeriodos?: number;
}

export interface DecisaoPessoaParada {
  decisao: "trabalho_atual" | "antecipacao" | "antecipacao_alivio_capacidade" | "sem_posto_auditavel";
  posto?: string;
  motivo?: MotivoSemPosto;
  descricao: string;
}

/** Escolhe o trabalho útil de uma pessoa-período livre. Hierarquia: VALOR_ATUAL > VALOR_FUTURO (nunca sacrifica a semana atual). */
export function decidirPessoaParada(opcoes: OpcaoDePosto[], limiarAtual = 0.5, limiarFuturo = 0.5): DecisaoPessoaParada {
  const validas = opcoes.filter((o) => o.maquinaPermitida && o.hardOk && o.temMaterial);
  const atuais = validas.filter((o) => o.valorAtual > limiarAtual).sort((a, b) => b.valorAtual - a.valorAtual || b.valorFuturo - a.valorFuturo || (a.posto < b.posto ? -1 : 1));
  if (atuais.length) return { decisao: "trabalho_atual", posto: atuais[0].posto, descricao: `valor atual R$ ${atuais[0].valorAtual.toFixed(2)} (semana atual primeiro)` };
  const fut = validas.filter((o) => o.valorAtual >= -limiarAtual && o.valorFuturo > limiarFuturo).sort((a, b) => b.valorFuturo - a.valorFuturo || (a.posto < b.posto ? -1 : 1));
  if (fut.length) return { decisao: "antecipacao", posto: fut[0].posto, descricao: `valor atual R$ ${fut[0].valorAtual.toFixed(2)} (neutro) < valor futuro R$ ${fut[0].valorFuturo.toFixed(2)}` };
  const alivio = validas.filter((o) => o.valorAtual >= -limiarAtual && (o.alivioPostoPeriodos ?? 0) > 0.05).sort((a, b) => (b.alivioPostoPeriodos ?? 0) - (a.alivioPostoPeriodos ?? 0) || (a.posto < b.posto ? -1 : 1));
  if (alivio.length) return { decisao: "antecipacao_alivio_capacidade", posto: alivio[0].posto, descricao: `valor atual neutro e valor futuro R$ 0 em R$, mas libera ${(alivio[0].alivioPostoPeriodos ?? 0).toFixed(2)} posto-período(s) da próxima semana (dentro do teto e da demanda futura)` };
  let motivo: MotivoSemPosto;
  if (!opcoes.some((o) => o.maquinaPermitida)) motivo = "nenhuma_maquina_permitida";
  else if (!opcoes.some((o) => o.maquinaPermitida && o.hardOk)) motivo = "hard_constraints_impedem";
  else if (!opcoes.some((o) => o.maquinaPermitida && o.hardOk && o.temMaterial)) motivo = "nenhum_material";
  else motivo = "nenhuma_demanda_atual_nem_futura";
  return { decisao: "sem_posto_auditavel", motivo, descricao: `exceção auditável: ${motivo}` };
}
