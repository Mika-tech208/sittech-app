import { describe, it, expect } from "vitest";
import type { ResumoControleWip } from "@/features/escala/wipSaldo";
import { alertaInconsistencia, exigeMotivo, linhaLimiteWip, linhaPrevistoWip, resumoCabecalhoWip, ROTULO_STATUS_WIP, textoUltimaConfirmacao } from "../estoqueIntermediarioTexto";

const resumo = (p: Partial<ResumoControleWip>): ResumoControleWip => ({ status: "estimado", previstoOrigem: 56400, alocado: 0, aProduzir: 56400, ultimaConfirmacao: null, inconsistencias: [], ...p } as ResumoControleWip);

describe("estoque intermediário — textos", () => {
  it("status com os quatro rótulos pedidos", () => {
    expect(ROTULO_STATUS_WIP).toEqual({ sem_saldo: "Sem saldo", estimado: "Estimado", confirmado: "Confirmado", divergencia: "Divergência" });
  });
  it("Previsto 56.400 · WIP confirmado 7.200 · A produzir 49.200", () => {
    expect(linhaPrevistoWip(resumo({ alocado: 7200, aProduzir: 49200 }))).toBe("Previsto: 56.400 · WIP confirmado: 7.200 · A produzir: 49.200");
  });
  it("cabeçalho recolhido resume controles, confirmados, a confirmar e divergências", () => {
    expect(resumoCabecalhoWip([])).toBe("· nenhum controle");
    expect(resumoCabecalhoWip([resumo({ status: "confirmado" }), resumo({ status: "estimado" }), resumo({ status: "divergencia" })])).toBe("· 3 controles · 1 confirmado · 1 a confirmar · 1 com divergência");
  });
  it("última confirmação mostra a data, a quantidade e a divergência do estimado", () => {
    expect(textoUltimaConfirmacao(resumo({}))).toBe("nunca confirmado");
    const u = { id: "k", controleId: "c", dataReferencia: "2026-10-25", quantidade: 9200, saldoEstimado: 9600, motivo: "contagem", criadoEm: "" };
    expect(textoUltimaConfirmacao(resumo({ ultimaConfirmacao: u }))).toBe("25/10/2026 · 9.200 pç (estimado era 9.600)");
  });
  it("motivo só é exigido quando a quantidade difere do estimado; alerta bloqueante explica", () => {
    expect(exigeMotivo(9600, 9600)).toBe(false);
    expect(exigeMotivo(9200, 9600)).toBe(true);
    expect(alertaInconsistencia({ codigo: "rota_alterada", mensagem: "O roteiro mudou.", bloqueante: true })).toContain("Não entra no planejamento até resolver");
  });

  it("linha do limite: limite, confirmado, reservado, WIP planejado e espaço restante", () => {
    const c = resumo({ limite: 20000, confirmadoOcupando: 14100, reservadoSemana: 7200, reservadoFuturo: 6900, adicionalPlanejado: 0, espacoRestante: 5900, acimaDoLimite: false });
    expect(linhaLimiteWip(c)).toBe("Limite 20.000 · Confirmado 14.100 · Reservado 7.200 nesta semana + 6.900 em semanas futuras · WIP planejado 0 · Espaço para novo WIP 5.900");
    expect(linhaLimiteWip(resumo({ limite: 10000, confirmadoOcupando: 12000, acimaDoLimite: true, espacoRestante: 0, reservadoSemana: 0, reservadoFuturo: 0, adicionalPlanejado: 0 }))).toContain("nenhum (acima do limite)");
    expect(linhaLimiteWip(resumo({ limite: null }))).toBeNull();
  });
});
