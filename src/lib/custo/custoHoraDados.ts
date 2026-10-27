// ÚNICA FONTE do custo/hora usado por TELA e SERVIDOR (M4). Antes, só a tela (hooks useFuncionarios/useCustos/useCadastrosBase) montava funcionários, custos fixos e horas/dia; o servidor não tinha custo e
// desempatava a divisão AUTO/CONV só por preferência. Agora: mesmos SELECTs, mesmos mapeadores de linha e a MESMA fórmula (`calcularCustoHoraEOperacoes`). Nenhum valor de custo é fixo no código.
import type { SupabaseClient } from "@supabase/supabase-js";
import { calcularCustoHoraEOperacoes } from "@/features/custo-hora/calculations";
import type { CustoHoraEOperacoes } from "@/features/custo-hora/types";
import { calcularHorasPorDia, calcularPeriodosComDuracao, filtrarPeriodosValidos } from "@/lib/calculations/periodos";
import type { FixedCost, Funcionario, Periodo } from "@/types/domain";

export const FUNCIONARIOS_SELECT = "id, nome, created_at, salario_base, ativo, desligado_em, operacoes(nome), funcionario_custos(id, descricao, valor)";
export const FIXED_COSTS_SELECT = "id, descricao, valor, ativo, categorias(nome)";

export interface FuncionarioRow {
  id: string; nome: string; created_at: string; salario_base: number; ativo: boolean; desligado_em?: string | null;
  operacoes: { nome: string } | null; funcionario_custos: { id: string; descricao: string; valor: number }[] | null;
}
export interface FixedCostRow { id: string; descricao: string; valor: number; ativo: boolean; categorias: { nome: string } | null }
export interface PeriodoRow { id: string; nome: string; inicio: string; fim: string }

export const mapearFuncionario = (f: FuncionarioRow): Funcionario => ({
  id: f.id, nome: f.nome, criadoEm: f.created_at, operacao: f.operacoes?.nome || "", salarioBase: Number(f.salario_base), ativo: f.ativo, desligadoEm: f.desligado_em ?? null,
  custos: (f.funcionario_custos || []).map((c) => ({ id: c.id, descricao: c.descricao, valor: Number(c.valor) })),
});
export const mapearFixedCost = (e: FixedCostRow): FixedCost => ({ id: e.id, descricao: e.descricao, categoria: e.categorias?.nome || "", valor: Number(e.valor), ativo: e.ativo });
export const mapearPeriodo = (p: PeriodoRow): Periodo => ({ id: p.id, nome: p.nome, inicio: String(p.inicio).slice(0, 5), fim: String(p.fim).slice(0, 5) });

// a fórmula, a partir de dados JÁ no formato de domínio (a tela e o servidor chegam aqui)
export function custoHoraDaEmpresa(i: { funcionarios: Funcionario[]; fixedCosts: FixedCost[]; periodos: Periodo[]; diasUteis: string | number }): CustoHoraEOperacoes {
  const horasDia = calcularHorasPorDia(filtrarPeriodosValidos(calcularPeriodosComDuracao(i.periodos)));
  return calcularCustoHoraEOperacoes(i.funcionarios, i.fixedCosts, horasDia, i.diasUteis);
}

// SERVIDOR: lê os mesmos cadastros e aplica a mesma fórmula. Erro de leitura = erro (nunca "sem custo" silencioso).
export async function carregarCustoHora(admin: SupabaseClient): Promise<CustoHoraEOperacoes> {
  const ok = <T>(r: { data: T | null; error: { message: string } | null }, nome: string): T => { if (r.error) throw new Error(`custo/hora (${nome}): ${r.error.message}`); return (r.data ?? []) as T; };
  const [f, c, p, cfg] = await Promise.all([
    admin.from("funcionarios").select(FUNCIONARIOS_SELECT).order("created_at"),
    admin.from("fixed_costs").select(FIXED_COSTS_SELECT).order("created_at"),
    admin.from("periodos").select("id, nome, inicio, fim").order("id"),
    admin.from("configuracoes_empresa").select("dias_uteis").limit(1).maybeSingle(),
  ]);
  const cfgData = ok(cfg as { data: { dias_uteis: number } | null; error: { message: string } | null }, "configuracoes_empresa") as unknown as { dias_uteis?: number };
  return custoHoraDaEmpresa({
    funcionarios: (ok(f, "funcionarios") as unknown as FuncionarioRow[]).map(mapearFuncionario),
    fixedCosts: (ok(c, "fixed_costs") as unknown as FixedCostRow[]).map(mapearFixedCost),
    periodos: (ok(p, "periodos") as unknown as PeriodoRow[]).map(mapearPeriodo),
    diasUteis: cfgData.dias_uteis ?? 22,
  });
}
