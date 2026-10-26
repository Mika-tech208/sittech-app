// Linha do tempo de situação do funcionário (ativo/inativo), BITEMPORAL — espelho exato de public.funcionario_ativo_em (SQL). Funções puras, sem IO.
//  • efetivoEm   = quando a mudança passou a valer (pode ser anterior ao registro: "saiu sexta 17:00, registrado segunda 08:00");
//  • registradoEm = quando o sistema recebeu o registro.
// Um corte (sombra) só pode "saber" o que já tinha sido REGISTRADO até ele — senão haveria hindsight.
import type { SituacaoFuncionarioEvento } from "./estado";

export function ativoNoCorte(eventos: SituacaoFuncionarioEvento[] | undefined, efetivoMs: number, conhecidoAteMs: number | null, ativoAtual: boolean): boolean {
  if (!eventos || eventos.length === 0) return ativoAtual; // cadastros anteriores a esta linha do tempo: vale o estado atual
  const ord = [...eventos].sort((a, b) => Date.parse(a.efetivoEm) - Date.parse(b.efetivoEm) || Date.parse(a.registradoEm) - Date.parse(b.registradoEm));
  const conhecidos = ord.filter((e) => Date.parse(e.efetivoEm) <= efetivoMs && (conhecidoAteMs === null || Date.parse(e.registradoEm) <= conhecidoAteMs));
  if (conhecidos.length > 0) return conhecidos[conhecidos.length - 1].ativoDepois;
  return ord[0].ativoAntes; // antes de qualquer evento conhecido: o estado anterior ao primeiro evento
}

export function historicoDeSituacao(linhas: { funcionario_id: string; acao: string; efetivo_em: string; registrado_em: string; ativo_antes: boolean; ativo_depois: boolean }[]): Record<string, SituacaoFuncionarioEvento[]> {
  const porFunc: Record<string, SituacaoFuncionarioEvento[]> = {};
  linhas.forEach((l) => {
    (porFunc[l.funcionario_id] ??= []).push({ acao: l.acao === "reativado" ? "reativado" : "desativado", efetivoEm: l.efetivo_em, registradoEm: l.registrado_em, ativoAntes: l.ativo_antes, ativoDepois: l.ativo_depois });
  });
  return porFunc;
}
