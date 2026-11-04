// Os 6 PASSOS do fechamento (estado puro, para a barra de progresso e para testar o fluxo):
// 1 Apontamentos dos postos programados · 2 Apontamentos extras · 3 Inventário intermediário físico · 4 Fechar período · 5 Recalcular · 6 Nova programação
export type EstadoPasso = "pendente" | "ativo" | "feito";
export interface EntradaPassos { apontamentosCompletos: boolean; inventarioCompleto: boolean; fase: "carregando" | "form" | "salvando" | "recalculando" | "confirmado" | "erro_recalculo" | "bloqueado" }
export const ROTULOS_PASSOS = ["Apontamentos dos postos", "Apontamento extra", "Inventário físico", "Fechar período", "Recalcular", "Nova programação"] as const;

export function estadoDosPassos(e: EntradaPassos): EstadoPasso[] {
  const fechando = e.fase === "salvando" || e.fase === "recalculando" || e.fase === "confirmado" || e.fase === "erro_recalculo";
  const p1: EstadoPasso = e.apontamentosCompletos ? "feito" : "ativo";
  const p2: EstadoPasso = e.apontamentosCompletos ? "feito" : "pendente";          // extra é opcional: considera-se vencido com o passo 1
  const p3: EstadoPasso = !e.apontamentosCompletos ? "pendente" : e.inventarioCompleto || fechando ? "feito" : "ativo";
  const p4: EstadoPasso = e.fase === "confirmado" ? "feito" : fechando ? "ativo" : e.apontamentosCompletos && e.inventarioCompleto ? "ativo" : "pendente";
  const p5: EstadoPasso = e.fase === "confirmado" ? "feito" : e.fase === "recalculando" || e.fase === "erro_recalculo" ? "ativo" : "pendente";
  const p6: EstadoPasso = e.fase === "confirmado" ? "feito" : "pendente";
  return [p1, p2, p3, p4, p5, p6];
}
