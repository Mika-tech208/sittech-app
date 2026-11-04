import { describe, expect, it } from "vitest";
import { visaoLiberacaoTv, type LiberacaoDia } from "../visaoTv";

// A decisão de liberar é do BANCO (testada em scripts/fechamento/teste-liberacao.sql: 19 cenários). Aqui: o que a TV faz com ela, FAIL-CLOSED.
const M3 = { id: "m3", nome: "M3" }, T1 = { id: "t1", nome: "T1" };
const pred = { data: "2026-11-04", periodo: "m2", rotulo: "M2" };
const lib = (m3: object, t1: object = { liberado: false, motivo: "AGUARDANDO_FECHAMENTO" }): LiberacaoDia => ({ m3: { liberado: false, motivo: "X", ...m3 }, t1: { liberado: false, motivo: "X", ...t1 } } as LiberacaoDia);
const v = (l: LiberacaoDia | null | undefined, agoraMs = 0) => visaoLiberacaoTv({ liberacao: l, atual: M3, proximo: T1, agoraMs });

describe("TV: só mostra a programação LIBERADA (fail-closed)", () => {
  it("teste 1/2: M3 antiga no banco, 8/12 ou 12/12 sem WIP ⇒ sem fechamento ⇒ M3 INVISÍVEL, pede nova programação", () => {
    const r = v(lib({ motivo: "AGUARDANDO_FECHAMENTO", predecessor: pred }));
    expect(r.atual.liberado).toBe(false); expect(r.proximo.liberado).toBe(false);
    expect(r.atual.bloqueio).toEqual({ titulo: "AGUARDANDO NOVA PROGRAMAÇÃO", detalhe: expect.stringMatching(/M2 encerrado.*Fechamento físico de M2 em andamento/) });
  });
  it("teste 3: RECALCULANDO ⇒ M3 INVISÍVEL ('RECALCULANDO M3…')", () => {
    const r = v(lib({ motivo: "RECALCULANDO", predecessor: pred }));
    expect(r.atual.liberado).toBe(false); expect(r.atual.bloqueio!.titulo).toBe("RECALCULANDO M3…");
  });
  it("teste 4: ERRO_RECALCULO ⇒ M3 INVISÍVEL ('PROGRAMAÇÃO NÃO LIBERADA')", () => {
    const r = v(lib({ motivo: "ERRO_RECALCULO", predecessor: pred }));
    expect(r.atual.liberado).toBe(false); expect(r.atual.bloqueio).toEqual({ titulo: "PROGRAMAÇÃO NÃO LIBERADA", detalhe: "Estoque salvo. Aguardando correção do recálculo." });
  });
  it("teste 5: CONFIRMADO mas o plano não é o gerado por esse fechamento ⇒ M3 INVISÍVEL", () => {
    const r = v(lib({ motivo: "CONFIRMADO_SEM_PLANO", predecessor: pred }));
    expect(r.atual.liberado).toBe(false); expect(r.atual.bloqueio!.titulo).toBe("AGUARDANDO NOVA PROGRAMAÇÃO");
  });
  it("teste 6: CONFIRMADO + plano gerado persistido ⇒ M3 VISÍVEL e 'M3 LIBERADO' por 2 min; T1 segue invisível", () => {
    const l = lib({ liberado: true, motivo: "CONFIRMADO", confirmado_em: "2026-11-04T13:26:52.745Z" });
    const t = Date.parse("2026-11-04T13:26:52.745Z");
    const r = v(l, t + 30_000);
    expect(r.atual).toEqual({ liberado: true, bloqueio: null }); expect(r.bannerLiberado).toBe("M3 LIBERADO"); expect(r.proximo.liberado).toBe(false);
    expect(v(l, t + 5 * 60_000).bannerLiberado).toBeNull();
  });
  it("teste 7: API/RPC indisponível ou snapshot sem a liberação ⇒ TUDO INVISÍVEL ('AGUARDANDO PROGRAMAÇÃO CONFIRMADA')", () => {
    for (const l of [undefined, null, {} as LiberacaoDia]) {
      const r = v(l); expect(r.atual.liberado).toBe(false); expect(r.proximo.liberado).toBe(false);
      expect(r.atual.bloqueio!.titulo).toBe("AGUARDANDO PROGRAMAÇÃO CONFIRMADA");
    }
  });
  it("período que não consta na liberação ⇒ bloqueado (nunca 'liberado por omissão')", () => {
    expect(visaoLiberacaoTv({ liberacao: { m3: { liberado: true, motivo: "CONFIRMADO" } }, atual: M3, proximo: T1, agoraMs: 0 }).proximo.liberado).toBe(false);
  });
  it("genérico: vale para qualquer troca (M1→M2 … T3→M1 do dia seguinte): quem decide é o mapa do banco, não o horário", () => {
    for (const [id, nome] of [["m2", "M2"], ["t1", "T1"], ["t2", "T2"], ["t3", "T3"], ["m1", "M1"]]) {
      expect(visaoLiberacaoTv({ liberacao: { [id]: { liberado: false, motivo: "AGUARDANDO_FECHAMENTO" } }, atual: { id, nome }, proximo: null, agoraMs: 9e12 }).atual.liberado).toBe(false);
      expect(visaoLiberacaoTv({ liberacao: { [id]: { liberado: true, motivo: "TRANSICAO" } }, atual: { id, nome }, proximo: null, agoraMs: 0 }).atual.liberado).toBe(true);
    }
  });
  it("simulação de relógio (?simular) ignora (somente leitura de quem opera a Escala)", () => {
    expect(visaoLiberacaoTv({ liberacao: null, atual: M3, proximo: T1, agoraMs: 0, ignorar: true }).atual.liberado).toBe(true);
  });
});
