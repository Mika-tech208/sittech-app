// NÃO PRODUZIU — motivos da tela × `sem_producao` existente. O banco (CHECK de apontamentos_producao) aceita 5 motivos grossos; o motivo FINO fica em
// apontamento_planejado_real.motivo_nao_produziu. A tabela abaixo é a MESMA que a RPC aplica (testada nos dois lados).
import type { MotivoNaoProduziu } from "./tipos";

export type MotivoSemProducaoBanco = "sem_programacao" | "falta_material" | "falta_operador" | "manutencao_programada" | "outro";
export interface DefMotivo { codigo: MotivoNaoProduziu; rotulo: string; banco: MotivoSemProducaoBanco; descricaoFixa: string | null; exigeDescricao: boolean }

export const MOTIVOS_NAO_PRODUZIU: readonly DefMotivo[] = [
  { codigo: "SEM_MATERIAL", rotulo: "Sem material", banco: "falta_material", descricaoFixa: null, exigeDescricao: false },
  { codigo: "PARADA", rotulo: "Parada", banco: "outro", descricaoFixa: "Parada de máquina", exigeDescricao: false },
  { codigo: "AUSENCIA", rotulo: "Ausência / sem operador", banco: "falta_operador", descricaoFixa: null, exigeDescricao: false },
  { codigo: "SETUP_REGULAGEM", rotulo: "Setup / regulagem", banco: "outro", descricaoFixa: "Setup/regulagem", exigeDescricao: false },
  { codigo: "FALTA_COMPONENTE", rotulo: "Falta de componente", banco: "falta_material", descricaoFixa: "Falta de componente", exigeDescricao: false },
  { codigo: "OUTRO", rotulo: "Outro", banco: "outro", descricaoFixa: null, exigeDescricao: true },
];

export const defMotivo = (c: MotivoNaoProduziu | null): DefMotivo | null => MOTIVOS_NAO_PRODUZIU.find((m) => m.codigo === c) ?? null;
export const rotuloMotivo = (c: MotivoNaoProduziu | null): string => defMotivo(c)?.rotulo ?? "—";

/** O que vai para `apontamentos_producao` (motivo_sem_producao + descricao_sem_producao). Espelha a RPC. */
export function paraSemProducao(c: MotivoNaoProduziu, descricao: string): { motivo: MotivoSemProducaoBanco; descricao: string | null } {
  const d = defMotivo(c);
  if (!d) throw new Error(`motivo desconhecido: ${c}`);
  const extra = descricao.trim() || null;
  const texto = d.descricaoFixa && extra ? `${d.descricaoFixa}: ${extra}` : (d.descricaoFixa ?? extra);
  return { motivo: d.banco, descricao: texto };
}

/** Lê o motivo grosso do banco de volta (apontamento lançado no painel) para exibir. */
export function motivoDoBanco(motivo: string | null): MotivoNaoProduziu | null {
  switch (motivo) { case "falta_material": return "SEM_MATERIAL"; case "falta_operador": return "AUSENCIA"; case "outro": return "OUTRO"; default: return null; }
}
