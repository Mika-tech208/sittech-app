import { describe, it, expect } from "vitest";
import { digestDasFontes, fechamentoLogicoMs, hashDoConteudo, montarConteudo, percentualDecimos, periodosConsiderados, statusDoRelatorio } from "../conteudo";
import { sha256Hex } from "@/features/escala/hashCanonico";
import { ap, aus, em, fontes, META, ofi, OP, SEG } from "./fixtures";

const ENCERRADA = em("18:30", "2026-11-06"); // depois do fechamento (sexta 18:00) => FINAL
const rotacaoOk = (f: string, dia = SEG, ops = [OP.rosq, OP.mont, OP.emb, OP.etiq, OP.rosq, OP.mont]) =>
  ["m1", "m2", "m3", "t1", "t2", "t3"].map((p, i) => ap(f, p, i % 2 === 0 ? "r3" : "m18", ops[i], "p1", {}, dia));

describe("status: parcial / final decidido pelo sistema (fechamento lógico: sexta 18:00; sábado 18:00 se produtivo)", () => {
  const SEX = "2026-11-06", SAB = "2026-11-07";
  it("sexta 17:59 é PARCIAL; sexta 18:00 é FINAL; registra o fechamento lógico", () => {
    const f = fontes();
    expect(statusDoRelatorio(f, em("17:59", SEX)).status).toBe("parcial");
    expect(statusDoRelatorio(f, em("18:00", SEX)).status).toBe("final");
    expect(statusDoRelatorio(f, em("18:07", SEX)).elegivelFinalEmMs).toBe(em("18:00", SEX));
    expect(montarConteudo(f, META(em("17:59", SEX))).status).toBe("parcial");
    expect(montarConteudo(f, META(em("18:07", SEX))).status).toBe("final");
    expect(montarConteudo(f, META(em("18:07", SEX))).elegivelFinalEmTexto).toBe("06/11/2026 às 18:00:00");
  });
  it("sexta SEM produção também fecha na sexta 18:00 (o dia produtivo é só a segunda)", () => {
    expect(fechamentoLogicoMs(fontes({ diasProdutivos: [SEG] }))).toBe(em("18:00", SEX));
  });
  it("sábado produtivo: NÃO finaliza na sexta; finaliza no sábado 18:00", () => {
    const f = fontes({ diasProdutivos: [SEG, SAB] });
    expect(fechamentoLogicoMs(f)).toBe(em("18:00", SAB));
    expect(statusDoRelatorio(f, em("18:00", SEX)).status).toBe("parcial");
    expect(statusDoRelatorio(f, em("17:59", SAB)).status).toBe("parcial");
    expect(statusDoRelatorio(f, em("18:00", SAB)).status).toBe("final");
  });
  it("domingo produtivo: fecha no domingo 18:00 (semana sem produção nenhuma é tratada pelo worker)", () => {
    expect(fechamentoLogicoMs(fontes({ diasProdutivos: [SEG, SAB, "2026-11-08"] }))).toBe(em("18:00", "2026-11-08"));
    expect(fechamentoLogicoMs(fontes({ diasProdutivos: ["2026-11-08"] }))).toBe(em("18:00", "2026-11-08"));
  });
  it("sábado NÃO produtivo (mesmo que exista na semana) não adia o fechamento da sexta", () => {
    expect(fechamentoLogicoMs(fontes({ diasProdutivos: [SEG, SEX] }))).toBe(em("18:00", SEX));
  });
  it("o sistema roda às 18:07, mas o relatório consolida até 18:00 (gerado 18:07, consolidado 18:00)", () => {
    const f = fontes();
    const c = montarConteudo(f, META(em("18:07", SEX), { consolidadoAteMs: em("18:00", SEX), fechamentoAutomatico: true }));
    expect(c.status).toBe("final");
    expect(c.consolidadoAteTexto).toBe("06/11/2026 18:00:00");
    expect(c.geradoEmTexto).toBe("06/11/2026 às 18:07:00");
    expect(c.fechamentoAutomatico).toBe(true);
    expect(c.toleranciaApontamentoMin).toBe(0);
  });
  it("no FINAL todo período encerrado até o fechamento entra (tolerância zero); no PARCIAL vale a tolerância de 30 min", () => {
    const f = fontes();
    expect(periodosConsiderados(f, "executada", em("17:10"), 0).map((p) => p.periodoId)).toContain("t3");
    expect(periodosConsiderados(f, "executada", em("17:10")).map((p) => p.periodoId)).not.toContain("t3");
    expect(montarConteudo(f, META(em("18:00", SEX))).dias[0].periodos.every((p) => p.considerado)).toBe(true);
  });
});

describe("períodos considerados (relatório parcial não trata o futuro como executado)", () => {
  it("às 12:00 só M1 e M2 (encerrados há ≥ 30 min); M3, tarde e o futuro ficam de fora", () => {
    const f = fontes();
    expect(periodosConsiderados(f, "executada", em("12:00")).map((p) => p.periodoId)).toEqual(["m1", "m2"]);
    const c = montarConteudo(f, META(em("12:00")));
    expect(c.dias[0].periodos.map((p) => p.considerado)).toEqual([true, true, false, false, false, false]);
    expect(c.funcionarios[0].dias[0].celulas.m3).toBeNull();
    expect(c.status).toBe("parcial");
  });
  it("a escala PLANEJADA considera todos os períodos dos dias produtivos", () => {
    expect(periodosConsiderados(fontes(), "planejada", em("07:00"))).toHaveLength(6);
  });
});

describe("revezamento do executado", () => {
  it("SIM: apontamentos nos 6 períodos, sem repetição; cobertura 100%", () => {
    const c = montarConteudo(fontes({ apontamentos: [...rotacaoOk("f1"), ...rotacaoOk("f2", SEG, [OP.mont, OP.rosq, OP.etiq, OP.emb, OP.mont, OP.rosq])] }), META(ENCERRADA));
    expect(c.status).toBe("final");
    expect(c.resumo.revezamento).toMatchObject({ estado: "SIM", verificadas: 10, naoVerificaveis: 0, violacoes: [] });
    expect(c.resumo.cobertura).toMatchObject({ esperados: 12, porApontamento: 12, numerador: 12, percentualTexto: "100,0%" });
  });
  it("M3→T1 conta como consecutivo (mesmo com o almoço): violação aparece no relatório", () => {
    const aps = rotacaoOk("f1", SEG, [OP.rosq, OP.mont, OP.emb, OP.emb, OP.rosq, OP.mont]); // M3 e T1 = Embalar
    const c = montarConteudo(fontes({ apontamentos: [...aps, ...rotacaoOk("f2", SEG, [OP.mont, OP.rosq, OP.etiq, OP.emb, OP.mont, OP.rosq])] }), META(ENCERRADA));
    expect(c.resumo.revezamento.estado).toBe("NAO");
    expect(c.resumo.revezamento.violacoes).toHaveLength(1);
    expect(c.resumo.revezamento.violacoes[0]).toMatchObject({ funcionario: "Ana", de: "M3", para: "T1", operacao: "Embalar" });
  });
  it("T3→M1 do dia seguinte REINICIA (mesma operação em T3 e no M1 seguinte não é violação)", () => {
    const d2 = "2026-11-03";
    const f = fontes({ diasProdutivos: [SEG, d2], periodosPorDia: {}, equipe: ["f1"], apontamentos: [...rotacaoOk("f1", SEG, [OP.rosq, OP.mont, OP.rosq, OP.mont, OP.rosq, OP.etiq]), ...rotacaoOk("f1", d2, [OP.etiq, OP.mont, OP.rosq, OP.mont, OP.rosq, OP.mont])] });
    const c = montarConteudo(f, META(em("20:00", "2026-11-06")));
    expect(c.resumo.revezamento.violacoes).toHaveLength(0);
    expect(c.resumo.revezamento.estado).toBe("SIM");
    expect(c.resumo.revezamento.verificadas).toBe(10); // 5 por dia; T3→M1 não é uma transição
  });
  it("SIM COM RESSALVAS: sem violação comprovada, mas transições sem apontamento não podem ser verificadas", () => {
    const aps = [...rotacaoOk("f1"), ...rotacaoOk("f2", SEG, [OP.mont, OP.rosq, OP.etiq, OP.emb, OP.mont, OP.rosq]).filter((a) => a.periodoId !== "t1")];
    const c = montarConteudo(fontes({ apontamentos: aps, oficial: [ofi("f2", "t1", "r3", OP.emb)] }), META(ENCERRADA));
    expect(c.resumo.revezamento.estado).toBe("SIM_COM_RESSALVAS");
    expect(c.resumo.revezamento.naoVerificaveis).toBe(2); // M3→T1 e T1→T2
    expect(c.resumo.revezamento.frase).toContain("2 transições não puderam ser verificadas por ausência de apontamento");
    expect(c.resumo.cobertura).toMatchObject({ esperados: 12, porApontamento: 11, oficialSemApontamento: 1 });
  });
  it("escala oficial SEM apontamento não é execução comprovada: nunca sustenta 'SIM'", () => {
    const f = fontes({ equipe: ["f1"], oficial: ["m1", "m2", "m3", "t1", "t2", "t3"].map((p, i) => ofi("f1", p, "r3", [OP.rosq, OP.mont, OP.emb, OP.etiq, OP.rosq, OP.mont][i])) });
    const c = montarConteudo(f, META(ENCERRADA));
    expect(c.resumo.revezamento.estado).toBe("SIM_COM_RESSALVAS");
    expect(c.resumo.revezamento.verificadas).toBe(0);
    expect(c.funcionarios[0].dias[0].celulas.m1?.fonte).toBe("OFICIAL_SEM_APONTAMENTO");
    expect(c.resumo.cobertura?.percentualTexto).toBe("0,0%");
  });
  it("usa a operacao_id GRAVADA no apontamento (não reinterpreta pelo roteiro): operações diferentes no apontamento = sem violação", () => {
    const f = fontes({ equipe: ["f1"], apontamentos: [ap("f1", "m1", "r3", OP.rosq), ap("f1", "m2", "r6", OP.mont)] });
    const c = montarConteudo(f, META(em("12:00")));
    expect(c.resumo.revezamento.violacoes).toHaveLength(0);
    const g = montarConteudo(fontes({ equipe: ["f1"], apontamentos: [ap("f1", "m1", "r3", OP.rosq), ap("f1", "m2", "r6", OP.rosq)] }), META(em("12:00")));
    expect(g.resumo.revezamento.violacoes).toHaveLength(1); // mesma operação gravada em máquinas diferentes continua violando
  });
});

describe("fonte da evidência", () => {
  it("ausência: AUSÊNCIA, nunca inventa posto; pares com ausência não se aplicam", () => {
    const c = montarConteudo(fontes({ equipe: ["f1", "f2"], apontamentos: rotacaoOk("f1"), ausencias: [aus("f2")], oficial: [ofi("f2", "m1", "r3", OP.rosq)] }), META(ENCERRADA));
    const f2 = c.funcionarios.find((x) => x.nome === "Bia")!;
    expect(Object.values(f2.dias[0].celulas).every((x) => x?.fonte === "AUSENCIA")).toBe(true);
    expect(c.resumo.revezamento.naoAplicaveis).toBe(5);
    expect(c.resumo.cobertura).toMatchObject({ porAusencia: 6, porApontamento: 6 });
    expect(c.ausencias).toHaveLength(1);
  });
  it("janela de atraso cobre só os períodos que ela atravessa", () => {
    const c = montarConteudo(fontes({ equipe: ["f1"], ausencias: [aus("f1", SEG, { tipo: "atraso", inicio: "07:12:00", fim: "09:00:00" })] }), META(ENCERRADA));
    const cel = c.funcionarios[0].dias[0].celulas;
    expect([cel.m1?.fonte, cel.m2?.fonte, cel.m3?.fonte]).toEqual(["AUSENCIA", "AUSENCIA", "SEM_EVIDENCIA"]);
  });
  it("apontamento diferente do planejado: mostra o REALIZADO, guarda o planejado e marca 'planejado diferente do realizado'", () => {
    const c = montarConteudo(fontes({ equipe: ["f1"], apontamentos: [ap("f1", "m1", "r3", OP.rosq)], oficial: [ofi("f1", "m1", "m18", OP.mont, "p2")] }), META(em("12:00")));
    const cel = c.funcionarios[0].dias[0].celulas.m1!;
    expect(cel.fonte).toBe("APONTAMENTO");
    expect(cel.postos[0]).toMatchObject({ maquina: "Rosqueadeira 3", operacao: "Rosquear" });
    expect(cel.planejado).toMatchObject({ maquina: "Montagem 18", operacao: "Montar Presilha" });
    expect(cel.divergente).toBe(true);
    expect(c.resumo.divergencias).toBe(1);
    const igual = montarConteudo(fontes({ equipe: ["f1"], apontamentos: [ap("f1", "m1", "r3", OP.rosq)], oficial: [ofi("f1", "m1", "r3", OP.rosq)] }), META(em("12:00")));
    expect(igual.funcionarios[0].dias[0].celulas.m1!.divergente).toBe(false);
  });
  it("oficial contradita (máquina apontada por outra pessoa / sem produção) = NÃO COMPROVADO; sem nada = SEM EVIDÊNCIA", () => {
    const f = fontes({
      equipe: ["f1", "f2"], oficial: [ofi("f1", "m1", "r3", OP.rosq), ofi("f1", "m2", "r6", OP.mont)],
      apontamentos: [ap("f2", "m1", "r3", OP.rosq), ap("f2", "m2", "r6", OP.mont, "p1", { status: "sem_producao", produzido: 0, motivo: "falta_operador", funcionarioId: null })],
    });
    const c = montarConteudo(f, META(em("12:00")));
    const f1 = c.funcionarios.find((x) => x.nome === "Ana")!.dias[0].celulas;
    expect(f1.m1?.fonte).toBe("NAO_COMPROVADO");
    expect(f1.m1?.detalhe).toContain("apontada por Bia");
    expect(f1.m2?.fonte).toBe("NAO_COMPROVADO");
    expect(f1.m2?.detalhe).toContain("falta de operador");
    expect(c.semProducao).toEqual([{ data: SEG, periodoId: "m2", maquina: "Rosqueadeira 6", motivo: "falta de operador" }]);
    const vazio = montarConteudo(fontes({ equipe: ["f1"] }), META(em("12:00")));
    expect(vazio.funcionarios[0].dias[0].celulas.m1?.fonte).toBe("SEM_EVIDENCIA");
  });
  it("funcionário desligado antes do período não é esperado (linha do tempo), mas apontamento existente continua aparecendo", () => {
    const f = fontes({ equipe: ["f1", "f2"], funcionarios: [{ id: "f1", nome: "Ana", ativo: true }, { id: "f2", nome: "Bia", ativo: false }, { id: "f3", nome: "Clara", ativo: true }],
      situacaoFuncionarios: [{ funcionarioId: "f2", acao: "desativado", efetivoEm: "2026-11-02T09:00:00-03:00", registradoEm: "2026-11-02T09:30:00-03:00", ativoAntes: true, ativoDepois: false }] });
    const c = montarConteudo(f, META(ENCERRADA));
    expect(c.resumo.cobertura?.esperados).toBe(6 + 2); // Ana: 6; Bia: só M1 e M2 (iniciam antes de 09:00); depois já estava desligada
  });
});

describe("cobertura de evidência (fórmula determinística)", () => {
  it("(apontamento + ausência) / esperados, em décimos, meio-para-cima: 225/240 = 93,8%", () => {
    expect(percentualDecimos(225, 240)).toBe(938);
    expect(percentualDecimos(0, 10)).toBe(0);
    expect(percentualDecimos(1, 3)).toBe(333);
    expect(percentualDecimos(2, 3)).toBe(667);
    expect(percentualDecimos(1, 0)).toBeNull();
  });
  it("cobertura parcial: soma das categorias = esperados", () => {
    const c = montarConteudo(fontes({ equipe: ["f1", "f2"], apontamentos: [ap("f1", "m1", "r3", OP.rosq)], ausencias: [aus("f2")], oficial: [ofi("f1", "m2", "m18", OP.mont)] }), META(em("12:00")));
    const k = c.resumo.cobertura!;
    expect(k.esperados).toBe(4);
    expect(k.porApontamento + k.porAusencia + k.oficialSemApontamento + k.naoComprovado + k.semEvidencia).toBe(k.esperados);
    expect(k.percentualTexto).toBe("75,0%"); // (1 + 2)/4
  });
});

describe("escala PLANEJADA", () => {
  it("mostra só o planejado (fonte PLANEJADO), sem cobertura; violação do plano aparece", () => {
    const f = fontes({ oficial: ["m1", "m2", "m3", "t1", "t2", "t3"].map((p, i) => ofi("f1", p, i % 2 ? "m18" : "r3", [OP.rosq, OP.mont, OP.mont, OP.etiq, OP.rosq, OP.mont][i])) });
    const c = montarConteudo(f, META(em("07:00"), { tipo: "planejada", codigo: "ESC-PLAN-2026-45-0001" }));
    expect(c.resumo.cobertura).toBeNull();
    expect(c.funcionarios[0].dias[0].celulas.m1?.fonte).toBe("PLANEJADO");
    expect(c.resumo.revezamento.estado).toBe("NAO"); // M2→M3 repete Montar Presilha no plano
    expect(c.resumo.revezamento.violacoes[0]).toMatchObject({ de: "M2", para: "M3" });
  });
});

describe("hash e digest", () => {
  const aps0 = rotacaoOk("f1");
  const base = () => fontes({ apontamentos: JSON.parse(JSON.stringify(aps0)) });
  it("mesmo snapshot => mesmo hash canônico; conteúdo diferente => hash diferente; versão 2 => hash diferente", () => {
    const a = hashDoConteudo(montarConteudo(base(), META(ENCERRADA)));
    const b = hashDoConteudo(montarConteudo(base(), META(ENCERRADA)));
    expect(a.hash).toBe(b.hash);
    expect(a.canonico).toBe(b.canonico);
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
    const alterado = base();
    alterado.apontamentos[0].produzido = 101;
    expect(hashDoConteudo(montarConteudo(alterado, META(ENCERRADA))).hash).not.toBe(a.hash);
    expect(hashDoConteudo(montarConteudo(base(), META(ENCERRADA, { versao: 2 }))).hash).not.toBe(a.hash);
  });
  it("o hash é o SHA-256 do texto canônico (vetor conhecido, com acentos — o banco confere com sha256())", () => {
    expect(sha256Hex("ação 1,5")).toBe("0f85bcc5cb1471bf40ed22e07f8016d5a99122bfa60bdfb0f3d0bf377c1739e8");
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
  it("digest dos insumos: muda com correção de apontamento/ausência/oficial dos períodos usados; NÃO muda com nomes nem com dados de períodos fora do recorte", () => {
    const f = base();
    const cons = periodosConsiderados(f, "executada", em("12:00"));
    const d0 = digestDasFontes(f, cons);
    expect(digestDasFontes(JSON.parse(JSON.stringify(f)), cons)).toBe(d0);
    const corrigido = JSON.parse(JSON.stringify(f)); corrigido.apontamentos.find((a: { periodoId: string }) => a.periodoId === "m1").produzido = 150;
    expect(digestDasFontes(corrigido, cons)).not.toBe(d0);
    const futuro = JSON.parse(JSON.stringify(f)); futuro.apontamentos.find((a: { periodoId: string }) => a.periodoId === "t3").produzido = 999;
    expect(digestDasFontes(futuro, cons)).toBe(d0);
    const renomeado = JSON.parse(JSON.stringify(f)); renomeado.funcionarios[0].nome = "Ana Maria";
    expect(digestDasFontes(renomeado, cons)).toBe(d0);
    const comAusencia = JSON.parse(JSON.stringify(f)); comAusencia.ausencias.push(aus("f2"));
    expect(digestDasFontes(comAusencia, cons)).not.toBe(d0);
  });
});
