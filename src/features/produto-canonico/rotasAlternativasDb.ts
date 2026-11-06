// Leitura (IO mínimo e tolerante) dos modelos canônicos VIGENTES para a decisão de indicadores consultivos. Nunca lança.
//   - sem modelo canônico (migration/backfill não aplicados, erro de leitura)                          => [] (nada muda)
//   - modelo existe e NENHUMA vigência (nem `produto_unico_planejamento_desde` nem `produto_unico_cutover`) => [] (antes do planejamento/cutover nada muda)
//   - modelo existe e há planejamento OU cutover definido, OU a leitura do cutover falhou                  => os modelos (falha SEGURA: prefere esconder o indicador a mostrar número errado)
// Os indicadores valem já no PLANEJAMENTO (a Previsão/plano futuro já usam o produto único), não só no cutover operacional.
import { lerModelosCanonicos, type ClienteLeitura } from "./modeloDb";
import { lerCutover } from "./cutover";
import type { ModeloCanonico } from "./tipos";

export interface ClienteModelosVigentes extends ClienteLeitura {
  rpc(nome: string): PromiseLike<{ data: unknown; error: unknown }>;
}

export async function lerModelosVigentes(client: ClienteModelosVigentes): Promise<ModeloCanonico[]> {
  try {
    const modelos = await lerModelosCanonicos(client);
    if (modelos.length === 0) return [];
    const [cut, plan] = await Promise.all([
      Promise.resolve(client.rpc("produto_unico_cutover")).catch(() => ({ data: null, error: true })),
      Promise.resolve(client.rpc("produto_unico_planejamento_desde")).catch(() => ({ data: null, error: true })),
    ]);
    const cutoverIlegivel = !!cut.error;
    const vigente = lerCutover(cut.data) !== null || (!plan.error && lerCutover(plan.data) !== null);
    return vigente || cutoverIlegivel ? modelos : [];
  } catch {
    return [];
  }
}
