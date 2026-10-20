// Textos do bloco "Estoque intermediário" — funções PURAS (a tela só mostra).
import type { InconsistenciaWip, ResumoControleWip, StatusWip } from "@/features/escala/wipSaldo";

export const ROTULO_STATUS_WIP: Record<StatusWip, string> = {
  sem_saldo: "Sem saldo",
  estimado: "Estimado",
  confirmado: "Confirmado",
  divergencia: "Divergência",
};

const fmt = (v: number) => Math.round(v).toLocaleString("pt-BR");

export function resumoCabecalhoWip(controles: ResumoControleWip[]): string {
  if (controles.length === 0) return "· nenhum controle";
  const conf = controles.filter((c) => c.status === "confirmado").length;
  const div = controles.filter((c) => c.status === "divergencia").length;
  const est = controles.filter((c) => c.status === "estimado").length;
  const partes = [`${controles.length} ${controles.length === 1 ? "controle" : "controles"}`];
  if (conf) partes.push(`${conf} confirmado${conf > 1 ? "s" : ""}`);
  if (est) partes.push(`${est} a confirmar`);
  if (div) partes.push(`${div} com divergência`);
  return `· ${partes.join(" · ")}`;
}

// "Previsto: 56.400 · WIP confirmado: 7.200 · A produzir: 49.200" — o previsto salvo nunca muda
export function linhaPrevistoWip(c: ResumoControleWip): string {
  return `Previsto: ${fmt(c.previstoOrigem)} · WIP confirmado: ${fmt(c.alocado)} · A produzir: ${fmt(c.aProduzir)}`;
}

// Limite de estoque do par: "Limite 20.000 · Confirmado 14.100 · Reservado 7.200 nesta semana + 6.900 futuras · WIP planejado 0 · Espaço para novo WIP 5.900"
export function linhaLimiteWip(c: ResumoControleWip): string | null {
  if (c.limite === null) return null;
  const partes = [
    `Limite ${fmt(c.limite)}`,
    `Confirmado ${fmt(c.confirmadoOcupando)}`,
    `Reservado ${fmt(c.reservadoSemana)} nesta semana${c.reservadoFuturo > 0 ? ` + ${fmt(c.reservadoFuturo)} em semanas futuras` : ""}`,
    `WIP planejado ${fmt(c.adicionalPlanejado)}`,
    c.acimaDoLimite ? "Espaço para novo WIP: nenhum (acima do limite)" : `Espaço para novo WIP ${fmt(c.espacoRestante ?? 0)}`,
  ];
  return partes.join(" · ");
}

export function textoUltimaConfirmacao(c: ResumoControleWip): string {
  const u = c.ultimaConfirmacao;
  if (!u) return "nunca confirmado";
  const [a, m, d] = u.dataReferencia.split("-");
  return `${d}/${m}/${a} · ${fmt(u.quantidade)} pç${u.quantidade !== u.saldoEstimado ? ` (estimado era ${fmt(u.saldoEstimado)})` : ""}`;
}

export function alertaInconsistencia(i: InconsistenciaWip): string {
  return `${i.bloqueante ? "Não entra no planejamento até resolver: " : ""}${i.mensagem}`;
}

// A confirmação exige motivo quando a quantidade difere do estimado
export function exigeMotivo(quantidade: number, estimado: number): boolean {
  return Math.abs(quantidade - estimado) > 1e-9;
}
