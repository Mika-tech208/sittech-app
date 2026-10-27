import { describe, it, expect } from "vitest";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { consultarEstadoRotas, garantirAtivacaoRotas, type EstadoAtivacaoRotas } from "@/lib/rotas/ativacao";
import AvisoModeloRotas from "../AvisoModeloRotas";

// o executor de testes local não usa o runtime JSX automático do Next; o componente só precisa do React global
(globalThis as unknown as { React: typeof React }).React = React;

const estado = (p: Partial<EstadoAtivacaoRotas> = {}): EstadoAtivacaoRotas => ({ programado: true, desde: "2026-11-02T03:00:00Z", desdeData: "2026-11-02", agora: "2026-11-02T10:00:00Z", dataConsultada: "2026-11-02", suporteManual: false, liberado: true, motivo: "", validacao: { ok: true, checks: [] }, ...p });
const html = (e: EstadoAtivacaoRotas | null, semana: string, item: Parameters<typeof AvisoModeloRotas>[0]["item"] = null) => renderToStaticMarkup(createElement(AvisoModeloRotas, { estado: e, semanaInicio: semana, item, nomeProduto: 'Conector 3/4" (Final)' }));

describe("ativação programada — cliente", () => {
  it("banco sem as funções (erro) = null = modelo fechado, sem aviso e sem exceção", async () => {
    const falho = { rpc: async () => ({ data: null, error: { message: "function does not exist" } }) } as never;
    expect(await consultarEstadoRotas(falho, "2026-11-02")).toBeNull();
    expect(await garantirAtivacaoRotas(falho)).toBeNull();
    expect(html(null, "2026-11-02")).toBe("");
  });
  it("antes do início: só informa a data; semana anterior ao início nunca vira modelo de rotas", () => {
    const h = html(estado({ liberado: false, motivo: "só abre a partir de 02/11/2026 00:00" }), "2026-10-26");
    expect(h).toContain("disponível a partir de"); expect(h).toContain("02/11/2026"); expect(h).not.toContain("NÃO liberado");
  });
  it("validação crítica falhou: NÃO abre, mostra o motivo e diz que o legado continua normal", () => {
    const h = html(estado({ liberado: false, motivo: "validação crítica falhou — maquinas_ambiguas: 1 máquina(s) em mais de uma etapa", validacao: { ok: false, checks: [{ id: "maquinas_ambiguas", ok: false, detalhe: "1" }] } }), "2026-11-02");
    expect(h).toContain("NÃO liberado"); expect(h).toContain("maquinas_ambiguas"); expect(h).toContain("legados continuam normais");
  });
  it("primeira semana: checklist (demanda, WIP físico/0, máquinas, capacidade, divisão, gargalo) sem inventar nada", () => {
    const h = html(estado(), "2026-11-02", null);
    expect(h).toContain("Primeira semana no novo modelo"); expect(h).toContain("informe a quantidade"); expect(h).toContain("saldo físico"); expect(h.replace(/<\/?b>/g, "")).toContain("WIP inicial é 0");
    expect(h).toContain("marque as máquinas"); expect(h).toContain("calculada depois de marcar as máquinas");
    const h2 = html(estado({ dataConsultada: "2026-11-09" }), "2026-11-09", null);
    expect(h2).toContain("Semana no modelo de rotas"); expect(h2).not.toContain("saldo físico");
  });
});
