// "APONTADO REAL" da Previsão semanal — DIAGNÓSTICO: quantas peças BOAS do produto foram concluídas segundo a Produção Real, contando SOMENTE a
// ÚLTIMA etapa do roteiro (uma peça passa por várias etapas; somar todas duplicaria/triplicaria). NÃO substitui o Realizado manual e NÃO entra em
// Falta, %, financeiro nem atingibilidade.
//
// Entrada: linhas já AGRUPADAS pelo banco (RPC obter_apontado_real_previsao_por_semana) por (produto, etapa, operação gravada no apontamento), com a produção
// boa (produzido - refugo; status 'produzindo'; edição é UPDATE no lugar e o histórico de edição fica fora) e o roteiro ATUAL daquela etapa/produto.
//
// ROTEIRO ALTERADO: o roteiro não é versionado (a edição altera `roteiro_etapas` no lugar, pelo id) e já houve etapas que trocaram de operação mantendo o id.
// O apontamento guarda, na época do lançamento, o `etapa_id` e a `operacao_id`. Só é CONTADO quando os dois ainda concordam com o roteiro atual
// (a etapa é a última E a operação gravada é a operação atual dela). Quando discordam e o apontamento poderia ser da etapa final por qualquer
// das duas leituras (etapa final pelo id OU operação final pelo nome), NÃO se conta e REPORTA-SE em `ambiguoPecas` — nenhuma correção silenciosa.
export interface LinhaApontadoEtapa {
  produtoId: string;
  etapaId: string | null;
  operacaoId: string | null; // gravada no apontamento
  quantidadeBoa: number;
  nApontamentos: number;
  etapaOrdem: number | null; // roteiro ATUAL da etapa (null = etapa não existe mais)
  etapaOperacaoId: string | null;
  ultimaOrdem: number | null; // maior ordem do roteiro atual do produto (null = produto sem roteiro)
  nNaUltimaOrdem: number; // >1 = empate na última ordem (não há "uma" etapa final)
  ultimaOperacaoId: string | null; // operação da etapa final (null quando há empate)
}

export interface ApontadoRealProduto {
  produtoId: string;
  apontadoReal: number; // peças boas da última etapa, só apontamentos coerentes com o roteiro atual
  nApontamentos: number; // apontamentos que compõem apontadoReal
  ambiguoPecas: number; // peças boas de apontamentos que podem ser da etapa final mas cujo roteiro mudou: NÃO contadas
  ambiguoApontamentos: number;
}

export function calcularApontadoReal(linhas: LinhaApontadoEtapa[]): Map<string, ApontadoRealProduto> {
  const mapa = new Map<string, ApontadoRealProduto>();
  for (const l of linhas) {
    const atual = mapa.get(l.produtoId) ?? { produtoId: l.produtoId, apontadoReal: 0, nApontamentos: 0, ambiguoPecas: 0, ambiguoApontamentos: 0 };
    mapa.set(l.produtoId, atual);
    if (l.ultimaOrdem === null) continue; // produto sem roteiro: não há etapa final
    const etapaEhUltima = l.etapaOrdem !== null && l.etapaOrdem === l.ultimaOrdem;
    const unicaFinal = l.nNaUltimaOrdem === 1;
    const coerente = l.etapaOperacaoId !== null && l.operacaoId === l.etapaOperacaoId; // o roteiro atual ainda diz o que o apontamento dizia
    if (coerente) {
      if (etapaEhUltima && unicaFinal) {
        atual.apontadoReal += l.quantidadeBoa;
        atual.nApontamentos += l.nApontamentos;
      } else if (etapaEhUltima && !unicaFinal) {
        atual.ambiguoPecas += l.quantidadeBoa; // empate na última ordem: não há como escolher "a" etapa final
        atual.ambiguoApontamentos += l.nApontamentos;
      }
      continue;
    }
    // roteiro alterado depois do lançamento (ou etapa removida): conta como ambíguo só se alguma leitura aponta para a etapa final
    const finalPeloId = etapaEhUltima;
    const finalPelaOperacao = l.ultimaOperacaoId !== null && l.operacaoId === l.ultimaOperacaoId;
    if (finalPeloId || finalPelaOperacao) {
      atual.ambiguoPecas += l.quantidadeBoa;
      atual.ambiguoApontamentos += l.nApontamentos;
    }
  }
  return mapa;
}

// total para a linha Total: soma por produto DISTINTO (dois itens previstos do mesmo produto não duplicam)
export function totalApontadoReal(produtoIds: string[], mapa: Map<string, ApontadoRealProduto>): { apontadoReal: number; ambiguoPecas: number } {
  const unicos = [...new Set(produtoIds)];
  return {
    apontadoReal: unicos.reduce((s, id) => s + (mapa.get(id)?.apontadoReal ?? 0), 0),
    ambiguoPecas: unicos.reduce((s, id) => s + (mapa.get(id)?.ambiguoPecas ?? 0), 0),
  };
}
