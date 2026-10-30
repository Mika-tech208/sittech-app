import { describe, expect, it } from "vitest";
import type { EntradaForecast, LigacaoForecast, NoForecast } from "../forecastBuffer";
import { agendarMontante } from "../forecastBuffer";
import { alapCurva, fontesAlternativas, necessidadeRetropropagada, penalidadeDeCadeia, repararCadeia, requisitoAcumulado, validarCadeia } from "../planejamentoCadeia";

// Cadeia genérica (ids opacos). Períodos de 100 min; 1 posto = 1.000 pç/período.
const periodos = (H: number) => Array.from({ length: H }, (_, t) => ({ rotulo: `P${t}`, duracaoMin: 100 }));
const serie = (H: number, v: number) => new Array<number>(H).fill(v);
const no = (id: string, H: number, prod: number, cap?: number, extra: Partial<NoForecast> = {}): NoForecast => ({
  id, rotulo: id, producaoPrevista: serie(H, prod), capacidadeMaxima: serie(H, cap ?? prod), pecasPorPosto: serie(H, 1000), postosPrevistos: serie(H, prod / 1000), ...extra,
});
const lig = (o: string, d: string, wip: number, extra: Partial<LigacaoForecast> = {}): LigacaoForecast => ({ id: `${o}${d}`, origem: o, destino: d, wipInicial: wip, confianca: "alta", ...extra });
const cadeia = (H: number, nos: NoForecast[], ligacoes: LigacaoForecast[]): EntradaForecast => ({ periodos: periodos(H), nos, ligacoes });
const L = (r: ReturnType<typeof necessidadeRetropropagada>, id: string) => r.ligacoes.find((l) => l.ligacaoId === id)!;

describe("retropropagação com lead time 1", () => {
  it("exemplo do usuário: 6.000 de WIP e consumo 3.000/período ⇒ dura 2 períodos; religar a origem 1 período antes da ruptura (Y−1 = 1)", () => {
    const H = 5;
    const e = cadeia(H, [no("A", H, 0, 3000), no("B", H, 3000)], [lig("A", "B", 6000)]);
    const r = necessidadeRetropropagada(e);
    const l = L(r, "AB");
    expect(l.cobertura.periodos).toBe(2);
    expect(l.periodoDaRuptura).toBe(2);
    expect(l.ultimoPeriodoSeguroLigar).toBe(1);
    expect(l.antecedenciaPeriodos).toBe(1);
    // produz só o necessário, só a partir do último período seguro (não "sempre ligado")
    expect(l.producaoNecessariaOrigem).toEqual([0, 3000, 3000, 3000, 0]);
    expect(l.inevitavel).toBe(0);
    expect(l.wipProjetado.every((v) => v >= 3000 - 1e-6)).toBe(true);
  });
  it("coincide com agendarMontante do forecast (lote 1) na ligação simples", () => {
    const C = [2000, 3000, 2500, 3000, 1000];
    const s0 = 4000;
    const ss = serie(5, 0);
    const a = agendarMontante(cumulativa(C), s0, serie(5, 4000), ss, false);
    const b = alapCurva(requisitoAcumulado(C, s0, 1, ss), serie(5, 4000));
    expect(b.producao).toEqual(a.producao);
    expect(b.inevitavel).toBe(a.inevitavel);
  });
  it("cadeia de 3 etapas: ruptura em T3 do último ⇒ meio liga em T2 e primeiro em T1 (propagação, sem estoque no meio)", () => {
    const H = 5;
    const e = cadeia(H, [no("A", H, 0, 5000), no("B", H, 0, 5000), no("C", H, 0, 5000, { producaoPrevista: [0, 0, 0, 3000, 3000] })], [lig("A", "B", 0), lig("B", "C", 0)]);
    const r = necessidadeRetropropagada(e);
    expect(L(r, "BC").ultimoPeriodoSeguroLigar).toBe(2);
    expect(L(r, "AB").ultimoPeriodoSeguroLigar).toBe(1);
    expect(L(r, "BC").producaoNecessariaOrigem).toEqual([0, 0, 3000, 3000, 0]);
    expect(L(r, "AB").producaoNecessariaOrigem).toEqual([0, 3000, 3000, 0, 0]);
  });
  it("cadeia de 4 etapas A→B→C→D com WIPs existentes: cada buffer dura e religa em cascata (6.000/6.000/3.600, consumo 3.000)", () => {
    const H = 6;
    const e = cadeia(H, [no("A", H, 0, 3000), no("B", H, 0, 3000), no("C", H, 0, 3000), no("D", H, 3000)], [lig("A", "B", 6000), lig("B", "C", 6000), lig("C", "D", 3600)]);
    const r = necessidadeRetropropagada(e);
    expect(L(r, "CD").cobertura.periodos).toBe(1.2); // 3.600 ÷ 3.000
    expect(L(r, "CD").periodoDaRuptura).toBe(1);
    expect(L(r, "CD").ultimoPeriodoSeguroLigar).toBe(0);
    // D só precisa de 2.400 de C em P0 (3.600 − 3.000 + 2.400 = 3.000 no início de P1); depois 3.000 ⇒ B→C (6.000) dura 2,2 ⇒ B religa em P1
    expect(L(r, "CD").producaoNecessariaOrigem.slice(0, 2)).toEqual([2400, 3000]);
    expect(L(r, "BC").cobertura.periodos).toBe(2.2);
    expect(L(r, "BC").ultimoPeriodoSeguroLigar).toBe(1);
    // B produz de P1 em diante (2.400, 3.000…) ⇒ A→B (6.000) rompe em P3 ⇒ A liga em P2
    expect(L(r, "AB").ultimoPeriodoSeguroLigar).toBe(2);
    expect(L(r, "AB").periodoDaRuptura).toBe(3);
  });
  it("mesma lógica para Rosquear→Parafusar quando Parafusar volta a produzir", () => {
    const H = 6;
    // C consome 3.000 por período; B→C (6.000) dura 2 ⇒ B volta a produzir em P1 ⇒ A→B (6.000) dura 2 períodos de consumo de B (P1,P2) ⇒ rompe em P3 ⇒ A liga em P2
    const e = cadeia(H, [no("A", H, 0, 3000), no("B", H, 0, 3000), no("C", H, 3000)], [lig("A", "B", 6000), lig("B", "C", 6000)]);
    const r = necessidadeRetropropagada(e);
    expect(L(r, "BC").ultimoPeriodoSeguroLigar).toBe(1);
    expect(L(r, "AB").periodoDaRuptura).toBe(3);
    expect(L(r, "AB").ultimoPeriodoSeguroLigar).toBe(2);
  });
  it("contagem alta mas duração calculada: 15.000 não é 'seguro' se o consumo é 3.000/período e o horizonte é longo", () => {
    const H = 8;
    const e = cadeia(H, [no("A", H, 0, 3000), no("B", H, 3000)], [lig("A", "B", 15000)]);
    const l = L(necessidadeRetropropagada(e), "AB");
    expect(l.cobertura.periodos).toBe(5);
    expect(l.ultimoPeriodoSeguroLigar).toBe(4);
  });
  it("capacidade limitada obriga a ligar antes e acusa o inevitável", () => {
    const H = 5;
    const e = cadeia(H, [no("A", H, 0, 1000), no("B", H, 3000)], [lig("A", "B", 0)]);
    const l = L(necessidadeRetropropagada(e), "AB");
    expect(l.inevitavel).toBe(11000); // 15.000 de consumo em 5 períodos, sem estoque, com a origem a 1.000/período e o 1º consumo já em P0
    expect(l.producaoNecessariaOrigem.slice(0, 4)).toEqual([1000, 1000, 1000, 1000]);
  });
  it("confiança baixa ⇒ margem de segurança liga antes (cobertura conservadora)", () => {
    const H = 6;
    const e = cadeia(H, [no("A", H, 0, 3000), no("B", H, 3000)], [lig("A", "B", 6000, { confianca: "baixa" })]);
    const base = L(necessidadeRetropropagada(e), "AB");
    const cons = L(necessidadeRetropropagada(e, { margemPorConfianca: { baixa: 0.5 } }), "AB");
    expect(base.ultimoPeriodoSeguroLigar).toBe(1);
    expect(cons.ultimoPeriodoSeguroLigar).toBe(0);
    expect(cons.producaoNecessariaOrigem[0]).toBeGreaterThan(0);
  });
  it("próximo dia produtivo (terça): exige estoque no fim do horizonte e liga a origem no último período", () => {
    const H = 3;
    const e = cadeia(H, [no("A", H, 0, 3000), no("B", H, 3000)], [lig("A", "B", 9000)]);
    const sem = L(necessidadeRetropropagada(e), "AB");
    expect(sem.ultimoPeriodoSeguroLigar).toBeNull();
    const com = L(necessidadeRetropropagada(e, { proximoDia: { rotulo: "ter M1", duracaoMin: 100, producaoPorNo: { B: 3000 } }, cenarioWip: "lo" }), "AB");
    expect(com.periodoDaRuptura).toBe(3);
    expect(com.ultimoPeriodoSeguroLigar).toBe(2);
  });
});

describe("validação da cadeia (forward, período a período)", () => {
  it("plano com downstream ativo e upstream ausente ⇒ INVÁLIDO (estoque 6.000 acaba no 3º período)", () => {
    const H = 5;
    const e = cadeia(H, [no("A", H, 0, 3000), no("B", H, 3000)], [lig("A", "B", 6000)]);
    const s = validarCadeia(e);
    expect(s.valido).toBe(false);
    expect(s.violacoes[0]).toMatchObject({ noId: "B", periodo: 2, desejada: 3000, disponivel: 0, falta: 3000 });
    expect(s.ligacoes[0].saldoInicial.slice(0, 3)).toEqual([6000, 3000, 0]);
    expect(penalidadeDeCadeia(s).invalido).toBe(true);
  });
  it("lote: produção de Tn só existe em Tn+1 (WIP início − consumo + produção do período anterior = WIP seguinte)", () => {
    const H = 4;
    const e = cadeia(H, [no("A", H, 2000), no("B", H, 3000)], [lig("A", "B", 3000)]);
    const s = validarCadeia(e);
    expect(s.ligacoes[0].saldoInicial).toEqual([3000, 2000, 2000, 2000]);
    expect(s.ligacoes[0].entrada).toEqual([0, 2000, 2000, 2000]);
    expect(s.violacoes.map((v) => v.periodo)).toEqual([1, 2, 3]);
  });
  it("plano coerente é válido", () => {
    const H = 4;
    const e = cadeia(H, [no("A", H, 3000), no("B", H, 3000)], [lig("A", "B", 3000)]);
    expect(validarCadeia(e).valido).toBe(true);
  });
  it("períodos fechados = REAL: entram no estoque como aconteceram e não geram violação; consumo real > disponível sinaliza dado conflitante", () => {
    const H = 4;
    const e = cadeia(H, [no("A", H, 2000), no("B", H, 3000)], [lig("A", "B", 3600)]);
    const s = validarCadeia(e, undefined, { producaoReal: { A: [2650, null, null, null], B: [5400, null, null, null] } });
    expect(s.consumoRealMaiorQueDisponivel).toEqual([{ noId: "B", periodo: 0, excesso: 1800 }]);
    expect(s.violacoes.every((v) => v.periodo > 0)).toBe(true);
    // estoque do início de P1 = 3.600 consumido por inteiro (clamp em 0) + 2.650 que a origem produziu em P0
    expect(s.ligacoes[0].saldoInicial[1]).toBe(2650);
  });
  it("múltiplas origens no mesmo destino: estoque total pooled, M8 não consome o rosqueado do buffer", () => {
    const H = 4;
    const e = cadeia(H, [no("R", H, 0, 3000), no("P", H, 0, 3000), no("M8", H, 0, 1000), no("E", H, 3000)], [lig("R", "P", 6000), lig("P", "E", 3000), lig("M8", "E", 0)]);
    const s = validarCadeia(e, { R: serie(H, 0), P: serie(H, 0), M8: [0, 1000, 1000, 1000], E: serie(H, 3000) });
    // E: P0 consome os 3.000 de P→E; em P1 nada chegou (M8 só produz de P1 em diante) ⇒ falta 3.000; em P2 chegam 1.000 do M8 ⇒ falta 2.000
    expect(s.violacoes[0]).toMatchObject({ noId: "E", periodo: 1, falta: 3000 });
    expect(s.violacoes[1]).toMatchObject({ noId: "E", periodo: 2, falta: 2000 });
    expect(s.ligacoes.find((l) => l.ligacaoId === "RP")!.saldoInicial).toEqual([6000, 6000, 6000, 6000]); // M8 não consome R→P
  });
});

describe("reparo da cadeia", () => {
  it("religa o upstream MÍNIMO no último período seguro (não 'sempre ligado')", () => {
    const H = 5;
    const e = cadeia(H, [no("A", H, 0, 3000), no("B", H, 3000)], [lig("A", "B", 6000)]);
    const r = repararCadeia(e);
    expect(r.original.valido).toBe(false);
    expect(r.escolhido.valida).toBe(true);
    expect(r.escolhido.plano.A).toEqual([0, 3000, 3000, 3000, 0]); // B falta em P2,P3,P4 ⇒ A só em P1,P2,P3 (último período seguro; P0 e P4 desligados)
  });
  it("religa em cascata pela cadeia inteira de 4 etapas (Embalar ⇒ Etiquetar ⇒ Parafusar ⇒ Rosquear)", () => {
    const H = 6;
    const e = cadeia(H, [no("A", H, 0, 3000), no("B", H, 0, 3000), no("C", H, 3000, 3000), no("D", H, 3000)], [lig("A", "B", 6000), lig("B", "C", 6000), lig("C", "D", 3600)]);
    const r = repararCadeia(e, undefined, { familias: ["religar_upstream"] });
    expect(r.escolhido.valida).toBe(true);
    const ex = r.escolhido.extra;
    expect(ex.B.some((v) => v > 0)).toBe(true); // Parafusar religado (C já planeja produzir; precisa de B)
    expect(ex.A.some((v) => v > 0)).toBe(true); // Rosquear religado depois que o seu buffer também acabaria
    // nunca ligado "o tempo todo": o primeiro período religado de B vem depois do 0
    expect(ex.B.findIndex((v) => v > 0)).toBeGreaterThan(0);
  });
  it("sem capacidade para repor, o candidato 'só religar' fica INVÁLIDO e 'religar+reduzir' vence", () => {
    const H = 4;
    const e = cadeia(H, [no("A", H, 0, 1000), no("B", H, 3000)], [lig("A", "B", 3000)]);
    const r = repararCadeia(e);
    expect(r.candidatos.find((c) => c.tipo === "religar_upstream")!.valida).toBe(false);
    expect(r.escolhido.valida).toBe(true);
    expect(r.escolhido.tipo === "religar_e_reduzir" || r.escolhido.tipo === "reduzir_downstream").toBe(true);
    expect(r.escolhido.pecasFinais).toBeLessThan(r.escolhido.pecasFinaisDesejadas);
    // capacidade livre sinalizada (nunca pessoa parada): postos do downstream que ficam sem material
    expect(r.escolhido.pessoasPeriodoLivres).toBeGreaterThan(0);
  });
  it("Máquina 8 como fonte alternativa: quando a convencional não alcança, 'trocar fonte' cobre; M8 não consome o WIP da convencional", () => {
    const H = 4;
    const e = cadeia(H, [no("R", H, 0, 3000), no("P", H, 0, 1000), no("M8", H, 0, 1000), no("E", H, 3000)], [lig("R", "P", 6000), lig("P", "E", 3000), lig("M8", "E", 0)]);
    const r = repararCadeia(e);
    const trocar = r.candidatos.filter((c) => c.tipo === "trocar_fonte" || c.tipo === "religar_upstream");
    const comM8 = trocar.find((c) => c.fontes.E?.[0] === "M8E")!;
    expect(comM8).toBeDefined();
    expect(comM8.extra.M8.some((v) => v > 0)).toBe(true);
    expect(comM8.extra.R.every((v) => v === 0)).toBe(true); // M8 não consome Rosquear
  });
  it("custo de oportunidade pelo produto final via callback: 'avaliar' decide entre candidatos válidos", () => {
    const H = 5;
    const e = cadeia(H, [no("A", H, 0, 3000), no("B", H, 3000)], [lig("A", "B", 6000)]);
    // avaliador que penaliza pessoas extras mais do que as peças finais valem ⇒ prefere reduzir
    const r = repararCadeia(e, undefined, { avaliar: (c) => (c.valida ? c.pecasFinais * 0.1 - c.pessoasPeriodoExtra * 10000 : -1e9) });
    expect(r.escolhido.tipo).toBe("reduzir_downstream");
    const r2 = repararCadeia(e, undefined, { avaliar: (c) => (c.valida ? c.pecasFinais * 1 : -1e9) });
    expect(r2.escolhido.tipo).toBe("religar_upstream");
  });
  it("plano já válido ⇒ nada a fazer (candidato 'manter' vence, sem pessoas extras)", () => {
    const H = 4;
    const e = cadeia(H, [no("A", H, 3000), no("B", H, 3000)], [lig("A", "B", 3000)]);
    const r = repararCadeia(e);
    expect(r.escolhido.pessoasPeriodoExtra).toBe(0);
    expect(r.escolhido.valida).toBe(true);
    expect(r.escolhido.extra.A.every((v) => v === 0)).toBe(true);
  });
  it("capacidade que não precisa proteger a cadeia aparece como removível (pessoa nunca parada)", () => {
    const H = 4;
    // A planeja 3.000/período mas o estoque de 12.000 já cobre o horizonte inteiro de B ⇒ tudo de A é removível
    const e = cadeia(H, [no("A", H, 3000), no("B", H, 3000)], [lig("A", "B", 12000)]);
    const n = necessidadeRetropropagada(e).nos.find((x) => x.noId === "A")!;
    expect(n.removivel.every((v) => v === 3000)).toBe(true);
    expect(n.postosLivres[0]).toBe(3);
  });
});

describe("fontes alternativas (cada fonte avaliada SOZINHA)", () => {
  it("Rosquear+Parafusar convencional × Máquina 8: pessoas-período, WIP a montante consumido e cobertura", () => {
    const H = 4;
    const e = cadeia(H, [no("R", H, 0, 3000), no("P", H, 0, 2000), no("M8", H, 0, 1000), no("E", H, 0, 3000, { producaoPrevista: [0, 3000, 0, 0] })], [lig("R", "P", 6000), lig("P", "E", 0), lig("M8", "E", 0)]);
    const f = fontesAlternativas(e, "E");
    const conv = f.find((x) => x.ligacaoId === "PE")!, m8 = f.find((x) => x.ligacaoId === "M8E")!;
    expect(conv.cobre).toBe(false); // P entrega no máx. 2.000 em P0 (chegam em P1) < 3.000
    expect(m8.cobre).toBe(false);
    expect(m8.wipMontanteConsumido).toBe(0);
    expect(conv.wipMontanteConsumido).toBeGreaterThan(0);
    expect(m8.pessoasPeriodo).toBe(1);
  });
});

const cumulativa = (v: number[]) => { let s = 0; return v.map((x) => (s += x)); };
