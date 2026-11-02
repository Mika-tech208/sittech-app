import { describe, expect, it } from "vitest";
import { planejarReverso, validarPlanoCadeia, explicarCadeia, type EntradaReverso, type ProdutoRev, type RecursoRev } from "../planoReverso";

const H = 12;
const per = Array.from({ length: H }, (_, i) => ({ rotulo: `P${i}`, duracaoMin: 90 }));
const rec = (id: string, n = 1): RecursoRev => ({ id, rotulo: id, unidades: new Array(H).fill(n) });
const alt = (recursoId: string, v: number) => ({ recursoId, pecasPorPosto: new Array(H).fill(v) });
/** rota genérica de n etapas, taxas por posto, 1 máquina por etapa (ids opacos) */
function rota(taxas: number[], demanda: number, wip: number[], id = "p"): { prod: ProdutoRev; recs: RecursoRev[] } {
  const recs = taxas.map((_, k) => rec(`${id}-r${k}`));
  return { recs, prod: { id, rotulo: id, etapas: taxas.map((v, k) => ({ id: `${id}-e${k}`, rotulo: `E${k}`, alternativas: [alt(`${id}-r${k}`, v)] })), demandaFinal: demanda, wipInicial: wip, recorrentePorPeriodo: 0 } };
}
const rodar = (prods: ProdutoRev[], recs: RecursoRev[], extra: Partial<EntradaReverso> = {}) => planejarReverso({ periodos: per, recursos: recs, produtos: prods, ...extra });
const cadeiaDe = (p: ProdutoRev) => ({ etapas: p.etapas.map((e) => ({ id: e.id, rotulo: e.rotulo })), wipInicial: p.wipInicial, periodos: per });
const soma = (v: number[]) => v.reduce((a, b) => a + b, 0);

describe("planoReverso — necessidade bruta × líquida", () => {
  it("2 etapas: preciso 6.000, tenho 2.000 ⇒ produzir 4.000", () => {
    const { prod, recs } = rota([5000, 1000], 6000, [2000]);
    const r = rodar([prod], recs);
    const p = r.produtos[0];
    expect(p.entregavel).toBe(6000);
    expect(soma(p.ligacoes[0].necessidadeLiquida)).toBe(4000);
    expect(soma(p.ligacoes[0].producaoOrigemObrigatoria)).toBe(4000);
    expect(validarPlanoCadeia(cadeiaDe(prod), p.plano).valido).toBe(true);
  });
  it("lead time 1: a produção de Tn só serve em Tn+1 (a origem produz um período antes do uso)", () => {
    const { prod, recs } = rota([1000, 1000], 1000, [0]);
    const p = rodar([prod], recs).produtos[0];
    const e0 = p.etapas[0].producaoObrigatoria, e1 = p.etapas[1].producaoObrigatoria;
    const t1 = e1.findIndex((v) => v > 0), t0 = e0.findIndex((v) => v > 0);
    expect(t0).toBe(t1 - 1);
  });
  it.each([2, 3, 4, 5])("rota genérica de %i etapas fica VÁLIDA e entrega a demanda quando cabe", (n) => {
    const { prod, recs } = rota(new Array(n).fill(1000), 4000, new Array(n - 1).fill(0));
    const p = rodar([prod], recs).produtos[0];
    expect(p.entregavel).toBe(4000);
    expect(validarPlanoCadeia(cadeiaDe(prod), p.plano).valido).toBe(true);
    // cada etapa anterior termina um período antes da seguinte (ALAP)
    for (let k = 0; k < n - 1; k++) {
      const last = (v: number[]) => v.map((x, i) => (x > 0 ? i : -1)).reduce((a, b) => Math.max(a, b), -1);
      expect(last(p.etapas[k].producaoObrigatoria)).toBe(last(p.etapas[k + 1].producaoObrigatoria) - 1);
    }
  });
  it("gargalo upstream mais lento ⇒ antecipa mais períodos e mais postos", () => {
    const rapido = rodar(...(([r]) => [[r.prod], r.recs] as [ProdutoRev[], RecursoRev[]])([rota([4000, 4000], 8000, [0])])).produtos[0];
    const lento = rodar(...(([r]) => [[r.prod], r.recs] as [ProdutoRev[], RecursoRev[]])([rota([1000, 4000], 8000, [0])])).produtos[0];
    const per0 = (p: typeof rapido) => p.etapas[0].producaoObrigatoria.filter((v) => v > 0).length;
    expect(per0(lento)).toBeGreaterThan(per0(rapido));
  });
  it("sem WIP e sem tempo: a capacidade limita o entregável e o plano continua válido (não promete o impossível)", () => {
    const { prod, recs } = rota([1000, 1000, 1000], 1e6, [0, 0]);
    const p = rodar([prod], recs).produtos[0];
    expect(p.entregavel).toBeLessThan(1e6);
    expect(p.entregavel).toBe(1000 * (H - 2));
    expect(validarPlanoCadeia(cadeiaDe(prod), p.plano).valido).toBe(true);
  });
});

describe("planoReverso — capacidade compartilhada", () => {
  it("duas rotas na mesma etiquetadora: a capacidade é UMA, nunca duplica (proporcional)", () => {
    const eti = rec("eti"), emb = rec("emb"), r1 = rec("ros"), m8 = rec("m8");
    const conv: ProdutoRev = { id: "conv", rotulo: "conv", demandaFinal: 6000, wipInicial: [0, 0], etapas: [
      { id: "c-ros", rotulo: "Ros", alternativas: [alt("ros", 3000)] }, { id: "c-eti", rotulo: "Eti", alternativas: [alt("eti", 1000)] }, { id: "c-emb", rotulo: "Emb", alternativas: [alt("emb", 3000)] }] };
    const aut: ProdutoRev = { id: "aut", rotulo: "aut", demandaFinal: 6000, wipInicial: [0], etapas: [
      { id: "a-m8", rotulo: "M8", alternativas: [alt("m8", 3000)] }, { id: "a-eti", rotulo: "Eti", alternativas: [alt("eti", 1000)] }, { id: "a-emb", rotulo: "Emb", alternativas: [alt("emb", 3000)] }].slice(0, 1) as never };
    // aut precisa de 3 etapas no mesmo formato: ajusta
    aut.etapas = [{ id: "a-m8", rotulo: "M8", alternativas: [alt("m8", 3000)] }, { id: "a-eti", rotulo: "Eti", alternativas: [alt("eti", 1000)] }, { id: "a-emb", rotulo: "Emb", alternativas: [alt("emb", 3000)] }];
    aut.wipInicial = [0, 0];
    const r = rodar([conv, aut], [eti, emb, r1, m8]);
    const usoEti = r.usoPorRecurso["eti"];
    for (let t = 0; t < H; t++) expect(usoEti.obrigatorio[t] + usoEti.antecipacao[t]).toBeLessThanOrEqual(1 + 1e-9);
    const total = r.produtos.reduce((s, p) => s + p.entregavel, 0);
    expect(total).toBeLessThanOrEqual(1000 * H + 1e-6);
    // proporcional: partes iguais (demandas iguais)
    expect(Math.abs(r.produtos[0].entregavel - r.produtos[1].entregavel)).toBeLessThan(1001);
    // prioridade: o primeiro leva tudo o que precisa
    const pr = rodar([conv, aut], [eti, emb, r1, m8], { compartilhamento: "prioridade" });
    expect(pr.produtos[0].entregavel).toBeGreaterThan(pr.produtos[1].entregavel);
    for (const p of pr.produtos) expect(validarPlanoCadeia(cadeiaDe(p === pr.produtos[0] ? conv : aut), p.plano).valido).toBe(true);
  });
});

describe("planoReverso — headcount e camadas", () => {
  it("postos-período = peças ÷ taxa e pessoas = postos distintos por período; déficit contra pessoas disponíveis", () => {
    const { prod, recs } = rota([1000, 1000, 1000, 1000], 4000, [0, 0, 0]);
    const ok = rodar([prod], recs, { pessoas: new Array(H).fill(4) });
    expect(ok.headcountMinimo).toBeGreaterThanOrEqual(1);
    const ap = rodar([prod], recs, { pessoas: new Array(H).fill(0) });
    expect(ap.periodosComDeficit.length).toBeGreaterThan(0);
    expect(ap.headcount.find((h) => h.deficit > 0)?.etapaMaisPostos).toBeTruthy();
  });
  it("antecipação útil é limitada pela demanda recorrente × períodos de extensão (nunca WIP infinito) e separada do obrigatório", () => {
    const { prod, recs } = rota([5000, 5000, 5000], 3000, [0, 0]);
    prod.recorrentePorPeriodo = 2000;
    const r = rodar([prod], recs, { pessoas: new Array(H).fill(10) });
    const p = r.produtos[0];
    expect(p.entregavel).toBe(3000);
    const estoqueSaida = p.ligacoes.map((l) => l.wipProjetado[H]);
    estoqueSaida.forEach((v) => expect(v).toBeLessThanOrEqual(2000 + 1e-6));
    expect(soma(p.ligacoes[1].producaoOrigemAntecipacao)).toBeGreaterThan(0);
    expect(validarPlanoCadeia(cadeiaDe(prod), p.plano).valido).toBe(true); // a antecipação nunca consome o que não existe
    const sem = rodar([{ ...prod, recorrentePorPeriodo: 0 }], recs).produtos[0];
    expect(sem.ligacoes[1].wipProjetado[H]).toBe(0);
  });
  it("sem pessoas livres não há antecipação (pessoa parada não é motivo, mas o obrigatório vem primeiro)", () => {
    const { prod, recs } = rota([5000, 5000, 5000], 3000, [0, 0]);
    prod.recorrentePorPeriodo = 2000;
    const folga = rodar([prod], recs, { pessoas: new Array(H).fill(10) }).headcountMinimo;
    const r = rodar([prod], recs, { pessoas: new Array(H).fill(folga) });
    r.headcount.forEach((h) => expect(h.postosObrigatorios + h.postosAntecipacao).toBeLessThanOrEqual(Math.max(h.postosObrigatorios, folga)));
  });
  it("antecipação é tudo-ou-nada por produto: sem pessoas para sustentar a cadeia inteira, reduz (e o plano continua válido)", () => {
    const { prod, recs } = rota([5000, 5000, 5000, 5000], 3000, [0, 0, 0]);
    prod.recorrentePorPeriodo = 2000;
    const obrigatorio = rodar([{ ...prod, recorrentePorPeriodo: 0 }], recs, { pessoas: new Array(H).fill(10) });
    const pico = obrigatorio.headcountMinimo;
    const r = rodar([prod], recs, { pessoas: new Array(H).fill(pico) });
    expect(validarPlanoCadeia(cadeiaDe(prod), r.produtos[0].plano).valido).toBe(true);
    r.headcount.forEach((h) => expect(h.postosObrigatorios + h.postosAntecipacao).toBeLessThanOrEqual(pico));
  });
  it("explicação em cadeia usa os números reais", () => {
    const { prod, recs } = rota([2000, 2000, 2000, 2000], 4000, [0, 0, 0]);
    const p = rodar([prod], recs).produtos[0];
    const t = p.etapas[3].producaoObrigatoria.findIndex((v) => v > 0);
    expect(explicarCadeia(p, t, ["Rosquear", "Parafusar", "Etiquetar", "Embalar"])).toMatch(/Para Embalar \d+ peças/);
  });
});

describe("TESTE FUNDAMENTAL — remover o upstream cedo quebra a cadeia; religar no último período seguro conserta; tarde demais não", () => {
  const taxas = [2000, 1500, 3000, 4500]; // Rosquear, Parafusar, Etiquetar, Embalar (Conector 3/4: o upstream é o lento)
  const montar = () => rota(taxas, 9000, [0, 0, 0]);
  it("plano reverso válido; sem Rosquear/Parafusar nos primeiros períodos ⇒ Etiquetar/Embalar sem material; religar no último seguro ⇒ válido; tarde demais ⇒ inválido", () => {
    const { prod, recs } = montar();
    const p = rodar([prod], recs).produtos[0];
    expect(p.entregavel).toBe(9000);
    const c = cadeiaDe(prod);
    expect(validarPlanoCadeia(c, p.plano).valido).toBe(true);
    const [ros, paf, eti, emb] = prod.etapas.map((e) => e.id);
    const primeiro = (v: number[]) => v.findIndex((x) => x > 0);
    const seguroPaf = primeiro(p.plano[paf]), seguroRos = primeiro(p.plano[ros]);
    expect(seguroPaf).toBeGreaterThan(seguroRos); // Rosquear precisa ligar antes
    // (1) REMOVE Rosquear e Parafusar
    const sem = { ...p.plano, [ros]: new Array(H).fill(0), [paf]: new Array(H).fill(0) };
    const v1 = validarPlanoCadeia(c, sem);
    expect(v1.valido).toBe(false);
    expect(v1.violacoes.some((x) => x.noId === eti || x.noId === emb)).toBe(true);
    // (2) RELIGA no último período seguro (= o plano reverso) ⇒ válido
    const religado = { ...sem, [ros]: p.plano[ros], [paf]: p.plano[paf] };
    expect(validarPlanoCadeia(c, religado).valido).toBe(true);
    // (3) RELIGA tarde demais (um período depois do último seguro) ⇒ continua inválido
    const atrasa = (v: number[]) => [0, ...v.slice(0, H - 1)];
    const tarde = { ...sem, [ros]: atrasa(p.plano[ros]), [paf]: atrasa(p.plano[paf]) };
    const v3 = validarPlanoCadeia(c, tarde);
    expect(v3.valido).toBe(false);
    // (4) só Rosquear tarde ⇒ Parafusar sem material
    const soRos = { ...p.plano, [ros]: atrasa(p.plano[ros]) };
    expect(validarPlanoCadeia(c, soRos).valido).toBe(false);
  });
  it("idem com 2 e 3 etapas (genérico)", () => {
    for (const n of [2, 3]) {
      const { prod, recs } = rota(new Array(n).fill(1500), 4500, new Array(n - 1).fill(0), `g${n}`);
      const p = rodar([prod], recs).produtos[0];
      const c = cadeiaDe(prod);
      expect(validarPlanoCadeia(c, p.plano).valido).toBe(true);
      const up = prod.etapas.slice(0, -1).map((e) => e.id);
      const sem = { ...p.plano, ...Object.fromEntries(up.map((id) => [id, new Array(H).fill(0)])) };
      expect(validarPlanoCadeia(c, sem).valido).toBe(false);
      const tarde = { ...p.plano, ...Object.fromEntries(up.map((id) => [id, [0, ...p.plano[id].slice(0, H - 1)]])) };
      expect(validarPlanoCadeia(c, tarde).valido).toBe(false);
      expect(validarPlanoCadeia(c, { ...sem, ...Object.fromEntries(up.map((id) => [id, p.plano[id]])) }).valido).toBe(true);
    }
  });
  it("com WIP que cobre os primeiros períodos, o upstream pode ligar mais tarde (último período seguro avança)", () => {
    const a = rodar(...(([r]) => [[r.prod], r.recs] as [ProdutoRev[], RecursoRev[]])([rota(taxas, 9000, [0, 0, 0])])).produtos[0];
    const b = rodar(...(([r]) => [[r.prod], r.recs] as [ProdutoRev[], RecursoRev[]])([rota(taxas, 9000, [6000, 6000, 3600])])).produtos[0];
    const prim = (p: typeof a, k: number) => p.etapas[k].producaoObrigatoria.findIndex((x) => x > 0);
    expect(prim(b, 0) === -1 || prim(b, 0) >= prim(a, 0)).toBe(true);
    expect(soma(b.etapas[0].producaoObrigatoria)).toBeLessThan(soma(a.etapas[0].producaoObrigatoria));
  });
});

describe("planoReverso — limitado por pessoas", () => {
  it("com poucas pessoas entrega o que cabe, nunca acima das pessoas, e a cadeia continua válida", () => {
    const { prod, recs } = rota([1000, 1000, 1000, 1000], 8000, [0, 0, 0]);
    const livre = rodar([prod], recs, { pessoas: new Array(H).fill(10) });
    const lim = rodar([prod], recs, { pessoas: new Array(H).fill(2), limitarPorPessoas: true });
    expect(livre.produtos[0].entregavel).toBe(8000);
    expect(lim.produtos[0].entregavel).toBeGreaterThan(0);
    expect(lim.produtos[0].entregavel).toBeLessThan(8000);
    lim.headcount.forEach((h) => expect(h.postosObrigatorios).toBeLessThanOrEqual(2));
    expect(validarPlanoCadeia(cadeiaDe(prod), lim.produtos[0].plano).valido).toBe(true);
  });
  it("sem restrição ativa o resultado é idêntico (mesmo plano)", () => {
    const { prod, recs } = rota([1000, 1000, 1000], 4000, [0, 0]);
    const a = rodar([prod], recs, { pessoas: new Array(H).fill(10) });
    const b = rodar([prod], recs, { pessoas: new Array(H).fill(10), limitarPorPessoas: true });
    expect(b.produtos[0].plano).toEqual(a.produtos[0].plano);
  });
});
