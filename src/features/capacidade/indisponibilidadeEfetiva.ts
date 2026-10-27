// Indisponibilidade EFETIVA de máquinas para a Capacidade/Previsão — a MESMA verdade que a Escala usa.
//
// A Escala trata uma máquina como indisponível quando existe QUALQUER causa ativa em escala_recurso_indisponivel (Parada de máquina
// da Produção Real, espelhada por trigger, ou bloqueio manual) ou quando a Previsão da semana a marca como indisponível. A Capacidade
// lê as mesmas causas (RPC escala_maquinas_indisponiveis_agora) e as soma às marcadas na semana.
//
// Toda causa é ABERTA (sem prazo final) ou já terminou; portanto, olhando para o futuro, o estado é binário: máquina com causa aberta
// fica indisponível para o RESTO da semana corrente e para as semanas futuras. Semanas que já terminaram NÃO mudam (histórico intacto).
// Convenção da semana corrente: a máquina sai da conta da semana inteira — o mesmo critério do marcador manual "indisponível na semana".
// `maquinasIndisponiveisManuais` guarda só o que está gravado na Previsão (é o que o marcador manual regrava; nunca a Parada).

import type { Previsao } from "@/types/domain";

function fimDaSemana(semanaInicio: string): string {
  const d = new Date(`${semanaInicio}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 6);
  return d.toISOString().slice(0, 10);
}

export function aplicarIndisponibilidadeEfetiva(previsoes: Previsao[], indisponiveisAgora: ReadonlySet<string>, hojeIso: string): Previsao[] {
  if (indisponiveisAgora.size === 0) return previsoes;
  return previsoes.map((p) => {
    if (fimDaSemana(p.semanaInicio) < hojeIso) return p; // semana encerrada: nada muda
    const manuais = p.maquinasIndisponiveis ?? [];
    return { ...p, maquinasIndisponiveisManuais: manuais, maquinasIndisponiveis: [...new Set([...manuais, ...indisponiveisAgora])] };
  });
}
