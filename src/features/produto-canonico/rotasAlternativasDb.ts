// Leitura (IO mínimo e tolerante) dos modelos canônicos VIGENTES para a decisão de indicadores consultivos. Nunca lança.
//   - sem modelo canônico (migration/backfill não aplicados, erro de leitura)     => [] (nada muda)
//   - modelo existe e `produto_unico_cutover` = null (valor lido com sucesso)      => [] (antes do cutover nada muda)
//   - modelo existe e o cutover está definido, OU a leitura do cutover falhou       => os modelos (falha SEGURA: prefere esconder o indicador a mostrar número errado)
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
    const r = await client.rpc("produto_unico_cutover");
    if (!r.error && lerCutover(r.data) === null) return [];
    return modelos;
  } catch {
    return [];
  }
}
