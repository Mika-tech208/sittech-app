import { describe, it, expect } from "vitest";
import { gerarEscala } from "../gerarEscala";
import { selecionarAdicionalWip } from "../adicionalWip";
import { calcularLimitesWip, etapasPorProduto } from "../wip";
import { metaNoSlot } from "../folga";
import { chavePool, type PoolEscala } from "../types";
import { checarInvariantes, entrada, equipe } from "./helpers";
import { conferirInvariantes } from "./adicionalHelpers";
import { A, acabadoDe, cenarioAleatorio, comWip, produto, semWip, verificarWip } from "./adicionalWipHelpers";

const D1 = "2026-10-19";
const IL = 1e9;

describe("SPIKE — acabado antes de estoque intermediário, pipeline e tetos", () => {
  it("S1: capacidade para acabado E sobra para estoque — o acabado é o mesmo com ou sem estoque e o estoque só ocupa o que sobrou", () => {
    // etapa 3 é o gargalo do acabado (1 máquina); etapas 1 e 2 têm máquinas sobrando
    const pools = produto("pA", [["a1", "a2", "a3"], ["b1", "b2"], ["c1"]], { q: 100 });
    const base = entrada({ funcionarios: equipe(8), pools }, [D1]);
    const com = comWip(base);
    const sem = semWip(base);
    const rCom = gerarEscala(com);
    const rSem = gerarEscala(sem);
    expect(verificarWip(com, rCom)).toEqual([]);
    expect(acabadoDe(rSem, com.pools, "pA")).toBeGreaterThan(0);
    expect(acabadoDe(rCom, com.pools, "pA")).toBeGreaterThanOrEqual(acabadoDe(rSem, com.pools, "pA") - 1e-6); // estoque NUNCA prejudica o acabado
    const [e1, e2, e3] = etapasPorProduto(com.pools).get("pA")!;
    expect(A(rCom, e1)).toBeGreaterThan(A(rCom, e2)); // sobrou capacidade a montante => estoque
    expect(A(rCom, e2)).toBeGreaterThanOrEqual(A(rCom, e3));
    expect(A(rSem, e1)).toBeCloseTo(A(rSem, e2), 6); // sem estoque: etapas andam juntas (acabado puro)
    expect(A(rSem, e2)).toBeCloseTo(A(rSem, e3), 6);
    expect(conferirInvariantes(base, com)).toEqual([]);
  });

  it("S2: disputa por operador — cadeia do produto de maior valor primeiro; estoque só com a sobra", () => {
    // 5 pessoas sem posto: a cadeia de 3 etapas do produto caro leva 3; o barato não fecha cadeia (restam 2 pessoas)
    const caro = produto("pCaro", [["m1"], ["m2"], ["m3"]], { valor: 10 });
    const barato = produto("pBarato", [["n1", "n1b"], ["n2"], ["n3"]], { valor: 1 });
    const base = entrada({ funcionarios: equipe(5), pools: [...caro, ...barato] }, [D1]);
    const com = comWip(base);
    const r = gerarEscala(com);
    expect(verificarWip(com, r)).toEqual([]);
    const primeiro = r.alocacoes.filter((a) => a.periodoId === "m1" && a.maquinaId);
    expect(primeiro.filter((a) => a.produtoId === "pCaro").length).toBe(3); // cadeia completa do caro
    expect(acabadoDe(r, com.pools, "pCaro")).toBeGreaterThan(0);
    // o barato não tem pessoas para uma cadeia: só pode gerar estoque (A_último = 0) com a sobra
    expect(acabadoDe(r, com.pools, "pBarato")).toBeLessThanOrEqual(acabadoDe(r, com.pools, "pCaro"));
    // estoque do barato nunca reduz o acabado do caro
    expect(acabadoDe(r, com.pools, "pCaro")).toBeGreaterThanOrEqual(acabadoDe(gerarEscala(semWip(base)), com.pools, "pCaro") - 1e-6);
  });

  it("S3: etapa intermediária é o gargalo — acabado limitado por ela e estoque a montante limitado pelo teto", () => {
    // etapa 2 = 1 máquina de meta 50 (gargalo); etapas 1 e 3 têm 3 máquinas de meta 100
    const pools = produto("pG", [["a1", "a2", "a3"], ["b1"], ["c1", "c2", "c3"]], { q: 100, mu: [100, 50, 100] });
    const base = entrada({ funcionarios: equipe(10), pools }, [D1, "2026-10-20"]);
    const L = 150; // 3 períodos de consumo da etapa 2
    const com = comWip(base, { limite: L });
    const r = gerarEscala(com);
    expect(verificarWip(com, r)).toEqual([]);
    const [e1, e2, e3] = etapasPorProduto(com.pools).get("pG")!;
    // o acabado é no máximo o que o gargalo processa (50 por período, 12 períodos)
    expect(A(r, e3)).toBeLessThanOrEqual(A(r, e2) + 1e-6);
    expect(A(r, e2)).toBeLessThanOrEqual(50 * 12 + 1e-6);
    // o estoque entre 1 e 2 chega ao teto (e não passa dele)
    expect(A(r, e1) - A(r, e2)).toBeLessThanOrEqual(L + 1e-6);
    expect(A(r, e1) - A(r, e2)).toBeGreaterThan(L - 100 - 1e-6);
  });

  it("S4: recursos compartilhados — a máquina compartilhada vai para a cadeia do produto de maior valor, nunca duas pessoas na mesma máquina", () => {
    const caro = produto("pC", [["x1"], ["comp"]], { valor: 10 });
    const barato = produto("pB", [["y1"], ["comp"]], { valor: 1 });
    const base = entrada({ funcionarios: equipe(6), pools: [...caro, ...barato] }, [D1]);
    const com = comWip(base);
    const r = gerarEscala(com);
    expect(verificarWip(com, r)).toEqual([]);
    expect(checarInvariantes(com, r)).toEqual([]);
    const noComp = r.alocacoes.filter((a) => a.periodoId === "m1" && a.maquinaId === "comp");
    expect(noComp).toHaveLength(1);
    expect(noComp[0].produtoId).toBe("pC");
    expect(acabadoDe(r, com.pools, "pC")).toBeGreaterThan(acabadoDe(r, com.pools, "pB"));
  });

  it("S5: PIPELINE no mesmo período — a etapa seguinte consome o que a anterior produz no próprio período, sem criar material", () => {
    const pools = produto("pP", [["a", "a2"], ["b", "b2"], ["c", "c2"]], { q: 100 });
    const base = entrada({ funcionarios: equipe(6), pools }, [D1]);
    const com = comWip(base);
    const r = gerarEscala(com);
    const m1 = r.alocacoes.filter((a) => a.periodoId === "m1" && a.maquinaId && (a.pecasAdicional ?? 0) > 0);
    expect(m1.map((a) => a.etapaId).sort()).toEqual(["pP-e1", "pP-e2", "pP-e3"]); // as 3 etapas rodam juntas já no 1º período (pipeline)
    expect(m1.reduce((s, a) => s + (a.pecasAdicional ?? 0), 0)).toBe(300);
    expect(verificarWip(com, r)).toEqual([]);
    // etapa seguinte com mais máquinas do que a anterior: não processa mais do que existe
    const pools2 = produto("pQ", [["a"], ["b1", "b2", "b3"]], { q: 100 });
    const com2 = comWip(entrada({ funcionarios: equipe(5), pools: pools2 }, [D1]));
    const r2 = gerarEscala(com2);
    const [q1, q2] = etapasPorProduto(com2.pools).get("pQ")!;
    expect(A(r2, q2)).toBeLessThanOrEqual(A(r2, q1) + 1e-6);
    expect(verificarWip(com2, r2)).toEqual([]);
  });

  it("S6: teto de estoque 0 => nenhuma etapa produz além do que a seguinte consome (acabado puro)", () => {
    const pools = produto("pZ", [["a1", "a2", "a3"], ["b1"], ["c1"]], { q: 100 });
    const com = comWip(entrada({ funcionarios: equipe(8), pools }, [D1]), { limite: 0 });
    const r = gerarEscala(com);
    const [z1, z2, z3] = etapasPorProduto(com.pools).get("pZ")!;
    expect(A(r, z1)).toBeCloseTo(A(r, z2), 6);
    expect(A(r, z2)).toBeCloseTo(A(r, z3), 6);
    expect(verificarWip(com, r)).toEqual([]);
  });

  it("S7: a cadeia consome o ESTOQUE já existente (a etapa seguinte não precisa de produção nova a montante)", () => {
    // sem pessoas suficientes para a cadeia inteira, só estoque é possível nos primeiros períodos; depois o estoque vira acabado
    const posts = selecionarAdicionalWip({
      etapas: etapasPorProduto(produto("pS", [["a"], ["b"]], { q: 100 })),
      adicRem: new Map([["pS|pS-e1", 1e9], ["pS|pS-e2", 1e9]]),
      adicAlocado: new Map([["pS|pS-e1", 300], ["pS|pS-e2", 100]]), // 200 de estoque aguardando a etapa 2
      saldo0: new Map(),
      limites: { "pS|pS-e1": 1e9 },
      livres: (p) => (p.etapaId === "pS-e2" ? ["b"] : ["a"]),
      meta: () => 100,
      usadas: new Set(),
      orcamento: 1,
    });
    expect(posts).toHaveLength(1);
    expect(posts[0].pool.etapaId).toBe("pS-e2"); // com 1 pessoa o melhor é transformar estoque em acabado
    expect(posts[0].pecas).toBe(100);
  });

  it("limites: regra B (dias de consumo da etapa seguinte) e regra A (necessidade da próxima semana)", () => {
    const pools = produto("pL", [["a"], ["b1", "b2"], ["c"]], { q: 100, mu: [100, 80, 60] });
    const slots = entrada({ funcionarios: equipe(1), pools }, [D1]).slots;
    const b = calcularLimitesWip(pools, slots, { wipDiasLimite: 1 }, null);
    const dia = slots.filter((s) => s.data === D1);
    const cap = (p: PoolEscala) => dia.reduce((s, sl) => s + metaNoSlot(p, sl), 0) * new Set(p.maquinasIds).size;
    expect(b["pL|pL-e1"]).toBeCloseTo(cap(pools[1]), 6); // 1 dia da etapa 2
    expect(b["pL|pL-e2"]).toBeCloseTo(cap(pools[2]), 6); // 1 dia da etapa 3
    expect(Object.keys(b)).toHaveLength(2); // sem limite para a última etapa
    expect(calcularLimitesWip(pools, slots, { wipDiasLimite: 2 }, null)["pL|pL-e1"]).toBeCloseTo(2 * cap(pools[1]), 6);
    const a = calcularLimitesWip(pools, slots, { wipDiasLimite: 1 }, { quantidadePorProduto: { pL: 7000 } });
    expect(a["pL|pL-e1"]).toBe(7000);
    const ausente = calcularLimitesWip(pools, slots, { wipDiasLimite: 1 }, { quantidadePorProduto: {} });
    expect(ausente["pL|pL-e1"]).toBe(0); // produto fora da próxima semana: nenhum estoque
  });
});

describe("adicional por etapa — propriedades em cenários aleatórios", () => {
  it("por construção: no MESMO período o acabado decidido é idêntico com e sem teto de estoque (estoque só usa a sobra)", () => {
    let seed = 99;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (let i = 0; i < 200; i++) {
      const pools: PoolEscala[] = [];
      const maq = Array.from({ length: 7 }, (_, k) => `m${k + 1}`);
      const nProd = 1 + Math.floor(rnd() * 3);
      for (let p = 0; p < nProd; p++) {
        const nEt = 1 + Math.floor(rnd() * 3);
        pools.push(...produto(`p${p}`, Array.from({ length: nEt }, () => Array.from({ length: 1 + Math.floor(rnd() * 3) }, () => maq[Math.floor(rnd() * 7)])), { mu: Array.from({ length: nEt }, () => 40 + Math.floor(rnd() * 100)), valor: 1 + Math.floor(rnd() * 9) }));
      }
      const etapas = etapasPorProduto(pools);
      const alocado = new Map(pools.map((p) => [chavePool(p.produtoId, p.etapaId), Math.floor(rnd() * 3) * 100]));
      // estado coerente: etapa seguinte nunca acima da anterior
      etapas.forEach((l) => { for (let k = 1; k < l.length; k++) { const a = chavePool(l[k - 1].produtoId, l[k - 1].etapaId); const b = chavePool(l[k].produtoId, l[k].etapaId); alocado.set(b, Math.min(alocado.get(b) as number, alocado.get(a) as number)); } });
      const orc = 1 + Math.floor(rnd() * 8);
      const rodar = (limite: number) => selecionarAdicionalWip({
        etapas, adicRem: new Map(pools.map((p) => [chavePool(p.produtoId, p.etapaId), IL])), adicAlocado: new Map(alocado), saldo0: new Map(),
        limites: Object.fromEntries([...etapas.values()].flatMap((l) => l.slice(0, -1).map((p) => [chavePool(p.produtoId, p.etapaId), limite]))),
        livres: (p) => [...new Set(p.maquinasIds)].sort(), meta: (p) => p.metas.m1, usadas: new Set(), orcamento: orc,
      });
      const ultimas = new Set([...etapas.values()].map((l) => chavePool(l[l.length - 1].produtoId, l[l.length - 1].etapaId)));
      const acabado = (posts: ReturnType<typeof rodar>) => posts.filter((x) => ultimas.has(chavePool(x.pool.produtoId, x.pool.etapaId))).reduce((s, x) => s + x.pecas, 0);
      const com = rodar(1e9);
      const sem = rodar(0);
      expect(acabado(com)).toBeCloseTo(acabado(sem), 6);
      expect(com.length).toBeLessThanOrEqual(orc);
    }
  });

  it("150 cenários: previsto intacto, sem material fictício, teto de estoque, máquinas/produtos só da Previsão, acabado não prejudicado pelo estoque", () => {
    const falhas: string[] = [];
    for (let i = 0; i < 150; i++) {
      const { base, com } = cenarioAleatorio(1000 + i);
      const r = gerarEscala(com);
      const erros = [...conferirInvariantes(base, com), ...verificarWip(com, r)];
      // O estoque nunca prejudica o acabado do produto PRIORITÁRIO (maior valor, depois id): ele escolhe primeiro as máquinas e
      // as pessoas, e o estoque que se formou só amplia o que a cadeia dele consome. (Produtos de menor valor podem perder para
      // um de maior valor que passou a fechar cadeia com o estoque — é a prioridade, não roubo de estoque.)
      const rSem = gerarEscala(semWip(base));
      const ordem = [...etapasPorProduto(com.pools).entries()].sort(([ia, la], [ib, lb]) => lb[0].valorUnitario - la[0].valorUnitario || (ia < ib ? -1 : 1));
      const topo = ordem[0][0];
      if (acabadoDe(r, com.pools, topo) + 1e-6 < acabadoDe(rSem, com.pools, topo)) erros.push(`estoque reduziu o acabado do produto prioritário ${topo}`);
      if (erros.length) falhas.push(`cenário ${i}: ${erros.slice(0, 2).join("; ")}`);
    }
    expect(falhas).toEqual([]);
  });

  it("ociosidade só quando não existe trabalho adicional válido (front-loading: ninguém sem posto com trabalho possível no período)", () => {
    const falhas: string[] = [];
    for (let i = 0; i < 80; i++) {
      const { com } = cenarioAleatorio(5000 + i);
      const r = gerarEscala(com);
      const idx = new Map(com.slots.map((s) => [`${s.data}|${s.periodoId}`, s]));
      const etapas = etapasPorProduto(com.pools);
      com.slots.forEach((sl) => {
        const linhas = r.alocacoes.filter((a) => a.data === sl.data && a.periodoId === sl.periodoId);
        const ociosos = linhas.filter((a) => !a.maquinaId).length;
        if (ociosos === 0) return;
        // estado DEPOIS das decisões deste período (inclui o adicional que o próprio período já alocou)
        const alocado = new Map<string, number>();
        r.alocacoes.forEach((a) => {
          if (a.maquinaId && a.produtoId && a.etapaId && (a.pecasAdicional ?? 0) > 0 && (idx.get(`${a.data}|${a.periodoId}`) as { indice: number }).indice <= sl.indice) alocado.set(chavePool(a.produtoId, a.etapaId), (alocado.get(chavePool(a.produtoId, a.etapaId)) ?? 0) + (a.pecasAdicional as number));
        });
        const adicRem = new Map(com.pools.map((p) => [chavePool(p.produtoId, p.etapaId), Math.max(0, (p.adicionalMax ?? 0) - (alocado.get(chavePool(p.produtoId, p.etapaId)) ?? 0))]));
        const ocupadas = new Set(linhas.filter((a) => a.maquinaId).map((a) => a.maquinaId as string));
        const extra = selecionarAdicionalWip({
          etapas, adicRem, adicAlocado: alocado, saldo0: new Map(), limites: com.wip!.limites,
          livres: (p) => [...new Set(p.maquinasIds)].filter((m) => !ocupadas.has(m)).sort(),
          meta: (p) => metaNoSlot(p, sl),
          usadas: new Set(ocupadas), orcamento: ociosos,
        });
        // máquinas livres de verdade: as que NINGUÉM usou neste período (e não estão indisponíveis — aqui todas disponíveis)
        if (extra.length > 0) falhas.push(`cenário ${i} ${sl.data} ${sl.periodoId}: ${ociosos} sem posto mas havia ${extra.length} posto(s) de adicional válido(s)`);
      });
    }
    expect(falhas).toEqual([]);
  });
});
