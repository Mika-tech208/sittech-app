import { describe, expect, it } from "vitest";
import type { AlocacaoEscala } from "@/features/escala/types";
import type { ContagemFisicaPar } from "@/features/escala/fluxo/tipos";
import { lerParametros } from "@/features/escala/parametros";
import { lerCutover, lerCutoverDeParametros, produtoUnicoAtivo, segundaDaSemana } from "../cutover";
import { canonizarAlocacao, canonizarAlocacoes, canonizarContagens, demandaRestante, demandaUnica, problemasDoModelo, producaoFinalBoa, resolverEtapa, resolverProduto, rotaDaMaquina, somarWipEntrada } from "../mapeamento";
import { produtosSelecionaveis, produtosVisiveis } from "../guard";
import { AUTO, C, CAIXA, CAN, CONV, L, MAQ, ROTA1, ROTA2, modelo, profundoCongelado } from "./fixture";

const linha = (o: Partial<AlocacaoEscala>): AlocacaoEscala => ({ data: "2026-11-03", periodoId: "m1", funcionarioId: "f1", maquinaId: null, produtoId: null, etapaId: null, operacaoId: null, pecas: 0, motivoSemPosto: null, excecaoRevezamento: false, motivoExcecao: null, ...o });

describe("cutover (parâmetro produto_unico_cutover)", () => {
  it("só aceita segunda-feira >= 2026-11-02; resto = sem cutover", () => {
    expect(lerCutover("2026-11-02")).toBe("2026-11-02");
    expect(lerCutover("2026-11-09")).toBe("2026-11-09");
    expect(lerCutover("2026-11-03")).toBeNull(); // terça
    expect(lerCutover("2026-10-26")).toBeNull(); // anterior ao permitido
    expect(lerCutover(null)).toBeNull();
    expect(lerCutover(42)).toBeNull();
    expect(lerCutover("amanhã")).toBeNull();
  });
  it("segundaDaSemana e produtoUnicoAtivo", () => {
    expect(segundaDaSemana("2026-11-06")).toBe("2026-11-02");
    expect(segundaDaSemana("2026-11-08")).toBe("2026-11-02");
    expect(segundaDaSemana("2026-11-09")).toBe("2026-11-09");
    expect(produtoUnicoAtivo("2026-11-06", null)).toBe(false);
    expect(produtoUnicoAtivo("2026-11-06", "2026-11-09")).toBe(false);
    expect(produtoUnicoAtivo("2026-11-09", "2026-11-09")).toBe(true);
    expect(produtoUnicoAtivo("2026-10-30", "2026-11-02")).toBe(false); // semana passada: continua como registrada (Conv e Auto)
  });
  it("lê da lista de parâmetros do motor; a chave nova NÃO altera os parâmetros lidos (flag desligada = byte-idêntico)", () => {
    const base = [{ chave: "wip_modo", valor: "ativo" }, { chave: "revezamento_modo", valor: "duro" }];
    const comChave = [...base, { chave: "produto_unico_cutover", valor: null }];
    expect(JSON.stringify(lerParametros(comChave))).toBe(JSON.stringify(lerParametros(base)));
    expect(lerCutoverDeParametros(comChave)).toBeNull();
    expect(lerCutoverDeParametros([{ chave: "produto_unico_cutover", valor: "2026-11-09" }])).toBe("2026-11-09");
  });
});

describe("resolução legado -> canônico", () => {
  const m = modelo();
  it("produto e etapa: legado vira canônico, canônico e 'fora' passam intactos (idempotente)", () => {
    expect(resolverProduto(m, CONV)).toMatchObject({ produtoId: CAN, entrada: "legado", rotaId: ROTA1 });
    expect(resolverProduto(m, AUTO)).toMatchObject({ produtoId: CAN, entrada: "legado", rotaId: ROTA2 });
    expect(resolverProduto(m, CAN)).toMatchObject({ produtoId: CAN, entrada: "canonico" });
    expect(resolverProduto(m, CAIXA)).toMatchObject({ produtoId: CAIXA, entrada: "fora" });
    expect(resolverEtapa(m, L.eti).etapaId).toBe(C.eti);
    expect(resolverEtapa(m, L.etiA).etapaId).toBe(C.eti); // Etiquetar das duas rotas = mesma etapa canônica
    expect(resolverEtapa(m, resolverEtapa(m, L.emb).etapaId)).toMatchObject({ etapaId: C.emb, entrada: "canonico", papel: "FINAL" });
    expect(resolverEtapa(m, L.caixaEti)).toMatchObject({ entrada: "fora", papel: null });
  });
  it("a rota é conhecida pela máquina nas etapas anteriores; nas comuns não há rota", () => {
    expect(rotaDaMaquina(m, MAQ.p9)).toMatchObject({ rotaId: ROTA1, papel: "ROTA" });
    expect(rotaDaMaquina(m, MAQ.m8)).toMatchObject({ rotaId: ROTA2, papel: "ROTA" });
    expect(rotaDaMaquina(m, MAQ.et15)).toMatchObject({ rotaId: null, papel: "COMUM" });
    expect(rotaDaMaquina(m, MAQ.em17)).toMatchObject({ rotaId: null, papel: "FINAL" });
  });
  it("modelo íntegro e detecção de defeitos", () => {
    expect(problemasDoModelo(m)).toEqual([]);
    const dois = modelo(); dois.etapas[0].maquinasIds = [MAQ.p9]; // P9 em duas etapas
    expect(problemasDoModelo(dois).join()).toMatch(/ambíguo/);
    const ciclo = modelo(); ciclo.arestas.push({ origemEtapaId: C.emb, destinoEtapaId: C.ros });
    expect(problemasDoModelo(ciclo).join()).toMatch(/FINAL .* tem saída|ciclo/);
    const semFinal = modelo(); semFinal.etapas[4].papel = "COMUM";
    expect(problemasDoModelo(semFinal).join()).toMatch(/esperada 1 etapa FINAL/);
  });
});

describe("A. demanda única", () => {
  const m = modelo();
  it("64.800 Conv + 28.500 Auto => UM item Conector 3/4 de 93.300; máquinas = união por etapa canônica; Caixa intacta", () => {
    const itens = [
      { produtoId: CONV, quantidade: 64800, valorUnitario: 0.1825, maquinasPorEtapa: { [L.ros]: [MAQ.r3], [L.par]: [MAQ.p9], [L.eti]: [MAQ.et15], [L.emb]: [MAQ.em17] } },
      { produtoId: CAIXA, quantidade: 56400, valorUnitario: 0.217, maquinasPorEtapa: { [L.caixaEti]: ["x"] } },
      { produtoId: AUTO, quantidade: 28500, valorUnitario: 0.182, maquinasPorEtapa: { [L.m8]: [MAQ.m8], [L.etiA]: [MAQ.et15], [L.embA]: [MAQ.em17] } },
    ];
    const { itens: out, diagnosticos } = demandaUnica(profundoCongelado(itens), m, { valorUnitarioCanonico: 0.1825 });
    expect(out).toHaveLength(2);
    const u = out[0] as { produtoId: string; quantidade: number; valorUnitario: number; maquinasPorEtapa: Record<string, string[]>; origem: unknown[] };
    expect(u.produtoId).toBe(CAN);
    expect(u.quantidade).toBe(93300); // nunca 2 × 93.300 nem separado em Conv + Auto
    expect(u.valorUnitario).toBe(0.1825);
    expect(u.maquinasPorEtapa).toEqual({ [C.ros]: [MAQ.r3], [C.par]: [MAQ.p9], [C.eti]: [MAQ.et15], [C.emb]: [MAQ.em17], [C.m8]: [MAQ.m8] });
    expect(u.origem).toHaveLength(2);
    expect((out[1] as { produtoId: string }).produtoId).toBe(CAIXA);
    expect(diagnosticos).toEqual([]);
  });
  it("M8 não selecionada => nenhuma máquina na etapa M8 (rota automática indisponível, o motor nunca acrescenta)", () => {
    const { itens: out } = demandaUnica([{ produtoId: AUTO, quantidade: 28500, valorUnitario: 0.182, maquinasPorEtapa: { [L.etiA]: [MAQ.et15] } }, { produtoId: CONV, quantidade: 64800, valorUnitario: 0.1825, maquinasPorEtapa: { [L.par]: [MAQ.p9] } }], m, { valorUnitarioCanonico: 0.1825 });
    expect((out[0] as { maquinasPorEtapa: Record<string, string[]> }).maquinasPorEtapa[C.m8]).toBeUndefined();
  });
  it("sem preço único: média ponderada + diagnóstico (decisão do usuário pendente)", () => {
    const { itens: out, diagnosticos } = demandaUnica([{ produtoId: CONV, quantidade: 64800, valorUnitario: 0.1825, maquinasPorEtapa: {} }, { produtoId: AUTO, quantidade: 28500, valorUnitario: 0.182, maquinasPorEtapa: {} }], m);
    expect(out).toHaveLength(1);
    expect(diagnosticos[0].codigo).toBe("PRECO_MEDIO_PONDERADO");
  });
  it("sem nenhum legado: mesma referência (identidade)", () => {
    const itens = [{ produtoId: CAIXA, quantidade: 1, valorUnitario: 1, maquinasPorEtapa: {} }];
    expect(demandaUnica(itens, m).itens).toBe(itens);
  });
});

describe("E/10/11. produção final só na Embalagem; demanda restante única", () => {
  const m = modelo();
  it("apontamento da Embalagem (id legado do Conv, legado da Auto ou canônico) reduz a demanda total; Parafusar/M8/Etiquetar são WIP", () => {
    const ap = [
      { etapaId: L.emb, quantidadeBoa: 3000 }, // Embalagem registrada no Conv (como em PROD)
      { etapaId: C.emb, quantidadeBoa: 1000 }, // Embalagem já no canônico
      { etapaId: L.embA, quantidadeBoa: 500 }, // (não existe em PROD, mas se existir conta uma vez, na final)
      { etapaId: L.m8, quantidadeBoa: 9000 }, // WIP da rota automática: NÃO é produto final
      { etapaId: L.par, quantidadeBoa: 7000 }, { etapaId: L.eti, quantidadeBoa: 6000 },
    ];
    expect(producaoFinalBoa(ap, m)).toBe(4500);
    expect(demandaRestante(93300, producaoFinalBoa(ap, m))).toBe(88800);
    expect(demandaRestante(100, 4500)).toBe(0);
  });
  it("histórico real (semana 26/10): toda a Embalagem está no Conv e a Auto só tem M8; a visão canônica conta o final UMA vez (Embalagem) e M8 nunca entra como final", () => {
    const embalarConv = 82450, m8Auto = 21822; // semana 26/10 de PROD
    const somaSeM8Entrasse = embalarConv + m8Auto; // erro que uma visão "soma tudo / última etapa com dado" cometeria
    const canonico = producaoFinalBoa([{ etapaId: L.emb, quantidadeBoa: embalarConv }, { etapaId: L.m8, quantidadeBoa: m8Auto }], m);
    expect(somaSeM8Entrasse).toBe(104272);
    expect(canonico).toBe(82450);
  });
});

describe("F. WIP das duas rotas soma antes da Etiquetadora, sem duplicar", () => {
  const m = modelo();
  const t = Date.parse("2026-10-30T12:00:00-03:00");
  const c = (o: Partial<ContagemFisicaPar>): ContagemFisicaPar => ({ produtoId: CONV, etapaOrigemId: L.par, etapaSeguinteId: L.eti, saldo: 0, contadoEmMs: t, ...o });
  it("Parafusar->Etiquetar (Conv, ids legados) + M8->Etiquetar (Auto) = pool de entrada da Etiquetadora", () => {
    const { contagens, diagnosticos } = canonizarContagens(profundoCongelado([c({ saldo: 6000 }), c({ produtoId: AUTO, etapaOrigemId: L.m8, etapaSeguinteId: L.etiA, saldo: 2500 }), c({ etapaOrigemId: L.eti, etapaSeguinteId: L.emb, saldo: 3600 })]), m);
    expect(diagnosticos).toEqual([]);
    expect(contagens.map((x) => [x.etapaOrigemId, x.etapaSeguinteId, x.produtoId])).toEqual([[C.par, C.eti, CAN], [C.m8, C.eti, CAN], [C.eti, C.emb, CAN]]);
    const w = somarWipEntrada(contagens, m, C.eti, t + 1);
    expect(w.total).toBe(8500);
    expect(w.porOrigem).toEqual({ [C.par]: 6000, [C.m8]: 2500 });
    expect(somarWipEntrada(contagens, m, C.emb, t + 1).total).toBe(3600); // etiquetado -> embalar: um só pool
  });
  it("mesma contagem do pool comum nos dois produtos legados no mesmo instante NÃO soma (um estoque físico)", () => {
    const { contagens, diagnosticos } = canonizarContagens([c({ etapaOrigemId: L.eti, etapaSeguinteId: L.emb, saldo: 3600 }), c({ produtoId: AUTO, etapaOrigemId: L.etiA, etapaSeguinteId: L.embA, saldo: 3600 })], m);
    expect(contagens).toHaveLength(1);
    expect(somarWipEntrada(contagens, m, C.emb, t + 1).total).toBe(3600);
    expect(diagnosticos[0].codigo).toBe("CONTAGEM_COMUM_DUPLICADA");
  });
  it("usa a contagem mais recente <= agora por origem (nunca o futuro) e é idempotente", () => {
    const { contagens } = canonizarContagens([c({ saldo: 6000 }), c({ saldo: 4000, contadoEmMs: t + 3_600_000 })], modelo());
    expect(somarWipEntrada(contagens, m, C.eti, t + 1000).total).toBe(6000);
    expect(somarWipEntrada(contagens, m, C.eti, t + 4_000_000).total).toBe(4000);
    expect(canonizarContagens(contagens, m).contagens).toEqual(contagens);
  });
  it("contagem de produto fora do canônico passa intacta (mesma referência)", () => {
    const x = { produtoId: CAIXA, etapaOrigemId: L.caixaEti, etapaSeguinteId: "outra", saldo: 2000, contadoEmMs: t };
    expect(canonizarContagens([x], m).contagens[0]).toBe(x);
  });
});

describe("H. a escala atual não perde pessoas, máquinas nem quantidades ao ser lida no espaço canônico", () => {
  const m = modelo();
  const semana = (): AlocacaoEscala[] => [
    linha({ funcionarioId: "f1", maquinaId: MAQ.r3, produtoId: CONV, etapaId: L.ros, operacaoId: "op-ros", pecas: 1600 }),
    linha({ funcionarioId: "f2", maquinaId: MAQ.p9, produtoId: CONV, etapaId: L.par, operacaoId: "op-par", pecas: 1200 }),
    linha({ funcionarioId: "f3", maquinaId: MAQ.m8, produtoId: AUTO, etapaId: L.m8, operacaoId: "op-m8", pecas: 1100 }),
    linha({ funcionarioId: "f4", maquinaId: MAQ.et15, produtoId: CONV, etapaId: L.eti, operacaoId: "op-eti", pecas: 3000, distribuicao: [{ produtoId: CONV, etapaId: L.eti, pecas: 1800 }, { produtoId: AUTO, etapaId: L.etiA, pecas: 1200 }] }),
    linha({ funcionarioId: "f5", maquinaId: MAQ.em17, produtoId: CONV, etapaId: L.emb, operacaoId: "op-emb", pecas: 4500, distribuicao: [{ produtoId: CONV, etapaId: L.emb, pecas: 3300 }, { produtoId: AUTO, etapaId: L.embA, pecas: 1200 }] }),
    linha({ funcionarioId: "f6", maquinaId: null, motivoSemPosto: "sem_demanda" }),
    linha({ funcionarioId: "f7", maquinaId: "mx", produtoId: CAIXA, etapaId: L.caixaEti, operacaoId: "op-cx", pecas: 2200 }),
  ];
  it("soma de peças, pessoas e máquinas idênticas; Et15/Emb17 viram UMA linha canônica sem distribuição", () => {
    const antes = profundoCongelado(semana());
    const depois = canonizarAlocacoes(antes, m);
    const soma = (l: AlocacaoEscala[]) => l.reduce((s, x) => s + (x.maquinaId ? x.pecas : 0), 0);
    expect(soma(depois)).toBe(soma(antes));
    expect(depois.map((x) => x.funcionarioId)).toEqual(antes.map((x) => x.funcionarioId));
    expect(depois.map((x) => x.maquinaId)).toEqual(antes.map((x) => x.maquinaId));
    expect(depois.filter((x) => x.maquinaId).map((x) => x.pecas)).toEqual(antes.filter((x) => x.maquinaId).map((x) => x.pecas));
    const eti = depois[3];
    expect(eti).toMatchObject({ produtoId: CAN, etapaId: C.eti, pecas: 3000 });
    expect(eti.distribuicao).toBeUndefined();
    expect(depois[4]).toMatchObject({ produtoId: CAN, etapaId: C.emb, pecas: 4500 });
    expect(depois[2]).toMatchObject({ produtoId: CAN, etapaId: C.m8, pecas: 1100 }); // M8 = rota automática pelo posto
    expect(depois[5]).toBe(antes[5]); // sem posto: intacta
    expect(depois[6]).toBe(antes[6]); // Caixa Amarela: intacta
  });
  it("idempotente (canonizar duas vezes = uma) e estado misto (parte legado, parte canônico) converge", () => {
    const uma = canonizarAlocacoes(semana(), m);
    expect(canonizarAlocacoes(uma, m)).toBe(uma);
    const misto = [semana()[0], canonizarAlocacao(semana()[1], m)];
    const c = canonizarAlocacoes(misto, m);
    expect(c.every((x) => x.produtoId === CAN)).toBe(true);
  });
  it("linha compartilhada com produto de FORA do canônico mantém a distribuição traduzida", () => {
    const l = linha({ maquinaId: MAQ.et15, produtoId: CONV, etapaId: L.eti, pecas: 3000, distribuicao: [{ produtoId: CONV, etapaId: L.eti, pecas: 2000 }, { produtoId: CAIXA, etapaId: L.caixaEti, pecas: 1000 }] });
    const c = canonizarAlocacao(l, m);
    expect(c.distribuicao).toEqual([{ produtoId: CAN, etapaId: C.eti, pecas: 2000 }, { produtoId: CAIXA, etapaId: L.caixaEti, pecas: 1000 }]);
    expect(c.pecas).toBe(3000);
  });
});

describe("G/I. histórico intacto, flag desligada idêntica, rollback sem perda", () => {
  const m = modelo();
  it("nada é mutado: entradas congeladas profundamente atravessam todas as funções sem erro", () => {
    expect(() => {
      canonizarAlocacoes(profundoCongelado([linha({ maquinaId: MAQ.et15, produtoId: CONV, etapaId: L.eti, pecas: 10, distribuicao: [{ produtoId: CONV, etapaId: L.eti, pecas: 5 }, { produtoId: AUTO, etapaId: L.etiA, pecas: 5 }] })]), m);
      demandaUnica(profundoCongelado([{ produtoId: CONV, quantidade: 1, valorUnitario: 1, maquinasPorEtapa: { [L.par]: ["a"] } }]), m);
      canonizarContagens(profundoCongelado([{ produtoId: CONV, etapaOrigemId: L.par, etapaSeguinteId: L.eti, saldo: 1, contadoEmMs: 1 }]), m);
    }).not.toThrow();
  });
  it("flag desligada: guard devolve a MESMA lista; canônico escondido; seleção por data usa só os legados antes do cutover", () => {
    const produtos = [{ id: CONV, ativo: true }, { id: AUTO, ativo: true }, { id: CAN, ativo: false }, { id: CAIXA, ativo: true }];
    const canon = new Set([CAN]), leg = new Set([CONV, AUTO]);
    expect(produtosVisiveis(produtos, new Set(), null)).toBe(produtos); // sem canônico cadastrado: referência idêntica
    expect(produtosVisiveis(produtos, canon, null).map((p) => p.id)).toEqual([CONV, AUTO, CAIXA]);
    expect(produtosVisiveis(produtos, canon, "2026-11-09")).toBe(produtos);
    expect(produtosSelecionaveis(produtos, canon, leg, "2026-11-10", "2026-11-09").map((p) => p.id)).toEqual([CAN, CAIXA]);
    expect(produtosSelecionaveis(produtos, canon, leg, "2026-11-06", "2026-11-09").map((p) => p.id)).toEqual([CONV, AUTO, CAIXA]); // semana antiga: legados
  });
  it("sem modelo canônico (rollback do backfill) tudo é identidade: nada do legado muda", () => {
    const vazio = { ...modelo(), produtosLegado: {}, etapasLegado: {}, etapas: [], arestas: [] };
    const linhas = [linha({ maquinaId: MAQ.et15, produtoId: CONV, etapaId: L.eti, pecas: 10, distribuicao: [{ produtoId: CONV, etapaId: L.eti, pecas: 5 }, { produtoId: AUTO, etapaId: L.etiA, pecas: 5 }] })];
    expect(canonizarAlocacoes(linhas, vazio)).toBe(linhas);
    expect(resolverProduto(vazio, CONV).entrada).toBe("fora");
    expect(demandaUnica([{ produtoId: CONV, quantidade: 1, valorUnitario: 1, maquinasPorEtapa: {} }], vazio).itens).toHaveLength(1);
  });
  it("a visão por produto do histórico continua possível: linhas legadas são lidas sem tradução quando o modelo não as cobre", () => {
    const hist = [linha({ data: "2026-10-27", maquinaId: MAQ.m8, produtoId: AUTO, etapaId: L.m8, pecas: 1100 })];
    const l = canonizarAlocacoes(hist, m);
    expect(l[0].produtoId).toBe(CAN); // visão unificada sob demanda…
    expect(hist[0].produtoId).toBe(AUTO); // …mas o registro original nunca é alterado
  });
});
