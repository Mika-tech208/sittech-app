// Resumo de Faltas e Ausências por funcionário: quem entra na tabela e no denominador de horas previstas.
// Funcionário INATIVO hoje continua aparecendo no histórico — se teve registros no período ou ainda estava ativo em algum momento dele.
export interface FuncionarioDoResumo {
  id: string;
  nome: string;
  ativo: boolean;
  desligadoEm?: string | null; // ISO do desligamento efetivo
}

// dia (YYYY-MM-DD) do instante em America/Sao_Paulo
function diaSP(iso: string): string {
  return new Date(Date.parse(iso) - 3 * 3600_000).toISOString().slice(0, 10);
}

export function funcionariosParaResumo(todos: FuncionarioDoResumo[], idsComRegistroNoPeriodo: Iterable<string>, dataInicial?: string): { id: string; nome: string }[] {
  const comRegistro = new Set(idsComRegistroNoPeriodo);
  return todos
    .filter((f) => f.ativo || comRegistro.has(f.id) || (!!dataInicial && !!f.desligadoEm && diaSP(f.desligadoEm) >= dataInicial))
    .map((f) => ({ id: f.id, nome: f.nome }));
}
