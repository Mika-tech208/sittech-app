import { describe, it, expect } from "vitest";
import { checarInvariantes } from "@/features/escala/__tests__/helpers";
import { gerarEscala } from "@/features/escala/gerarEscala";
import { montarEntradaEscala } from "@/lib/escala/montarEntrada";
import { CADEIA_COMUM, cadeiasDe, ehVirtual, idVirtual, produtoRealDe, projetarEstado, reverterResultado } from "../adaptador";
import { resolverRotas } from "../resolucao";
import { repartirMaquina } from "../compartilhada";
import { AGORA, estadoF, etapaCaixa, F, ESTRUTURA_F, SEL_F } from "./fixtureRotas";

describe("M3 — adaptador das três cadeias (F#CONV, F#AUTO, F#COMUM)", () => {
  it("exemplo da decisão: AUTO 35.625, CONV 61.875, COMUM 97.500 (UMA cadeia comum, nunca duplicada por rota)", () => {
    const e = estadoF();
    const v = projetarEstado(e, { pF: { alvo: { AUTO: 35625, CONV: 61875 }, final: 97500 } });
    const q = (cadeia: string) => v.itens.find((i) => i.produtoId === idVirtual(F, cadeia))?.quantidade;
    expect(q("AUTO")).toBe(35625); expect(q("CONV")).toBe(61875); expect(q(CADEIA_COMUM)).toBe(97500);
    expect(v.itens).toHaveLength(3); expect(v.itens.some((i) => i.produtoId === F)).toBe(false);            // o produto real não vai ao motor
    // cadeias: CONV = Rosquear → Parafusar; AUTO = Rosquear+Parafusar; COMUM = Etiquetar → Embalar (sem Etiquetar/Embalar nas rotas)
    const ordem = (cadeia: string) => v.etapas.filter((x) => x.produtoId === idVirtual(F, cadeia)).sort((a, b) => a.ordem - b.ordem).map((x) => x.id);
    expect(ordem("CONV")).toEqual(["f-rosq", "f-para"]); expect(ordem("AUTO")).toEqual(["f-rp"]); expect(ordem(CADEIA_COMUM)).toEqual(["f-etiq", "f-emb"]);
    expect(v.etapas.filter((x) => x.id === "f-etiq")).toHaveLength(1); expect(v.etapas.filter((x) => x.id === "f-emb")).toHaveLength(1);
    // operação REAL em cada etapa (o revezamento "mesma operacao_id não consecutiva" continua valendo)
    expect(v.etapas.find((x) => x.id === "f-etiq")?.operacaoId).toBe("opEtiq"); expect(v.etapas.find((x) => x.id === "f-rp")?.operacaoId).toBe("opRP");
  });
  it("rota sem entrega planejada não vira cadeia; máquinas das cadeias vêm SÓ da seleção da Previsão", () => {
    const v = projetarEstado(estadoF(), { pF: { alvo: { AUTO: 20000, CONV: 0 }, final: 20000 } });
    expect(v.itens.map((i) => i.produtoId).sort()).toEqual([idVirtual(F, "AUTO"), idVirtual(F, CADEIA_COMUM)].sort());
    expect(v.itens.find((i) => i.produtoId === idVirtual(F, CADEIA_COMUM))?.maquinasPorEtapa).toEqual({ "f-etiq": ["E15"], "f-emb": ["EMB17"] });
  });
  it("produto linear não passa pelo adaptador: o MESMO estado volta, sem cópia", () => {
    const linear = { ...estadoF(), rotas: undefined };
    expect(projetarEstado(linear, {})).toBe(linear);
    const semProdutoDeRotas = { ...estadoF(), itens: [{ produtoId: "pCaixa", quantidade: 10, valorUnitario: 1, maquinasPorEtapa: { "c-etiq": ["E16"] } }] };
    expect(projetarEstado(semProdutoDeRotas, {})).toBe(semProdutoDeRotas);
    expect(resolverRotas(linear, AGORA)).toBeNull();
  });
  it("ids virtuais: identificáveis e reversíveis; cadeias derivadas da estrutura (não de ordem)", () => {
    expect(ehVirtual(idVirtual(F, "AUTO"))).toBe(true); expect(ehVirtual(F)).toBe(false); expect(produtoRealDe(idVirtual(F, "CONV"))).toBe(F);
    expect(cadeiasDe(ESTRUTURA_F).map((c) => c.cadeia)).toEqual(["AUTO", "CONV", "COMUM"]);
  });
});

describe("M3 — resolução com o motor real (sem máquina escolhida pelo sistema)", () => {
  it("caso real: demanda 116.625, só E15 ⇒ final planejado 97.500; motor entrega; tudo volta ao produto F", () => {
    const e = estadoF();
    const r = resolverRotas(e, AGORA)!;
    const p = r.produtos[F];
    expect(p.plano.final).toBeCloseTo(97500, 4); expect(p.plano.alvo.AUTO).toBeCloseTo(35625, 4); expect(p.plano.alvo.CONV).toBeCloseTo(61875, 4);
    expect(p.previa.plano.falta).toBeCloseTo(19125, 4); expect(p.previa.plano.gargalo).toEqual({ tipo: "comum", etapaId: "f-etiq", operacao: "Etiquetar" });
    expect(p.parada).toBe("atendeu_alvo"); expect(p.convergiu).toBe(true); expect(p.rodadas).toHaveLength(1);
    const montada = montarEntradaEscala(r.estadoVirtual, AGORA);
    const res = gerarEscala(montada.entrada);
    expect(checarInvariantes(montada.entrada, res)).toEqual([]);
    const volta = reverterResultado(res);
    expect(volta.alocacoes.every((a) => !ehVirtual(a.produtoId))).toBe(true);
    // só máquinas escolhidas na Previsão
    const permitidas = new Set(Object.values(SEL_F).flat());
    expect(volta.alocacoes.filter((a) => a.maquinaId).every((a) => permitidas.has(a.maquinaId as string))).toBe(true);
  });
  it("CONTROLE HUMANO: E16 compatível no cadastro mas NÃO marcada ⇒ capacidade 0 e nenhuma alocação nela; marcar E16 libera; desmarcar remove na hora", () => {
    const sem = resolverRotas(estadoF(), AGORA)!;
    const caps = sem.produtos[F].previa.plano.poolComum.etapas.find((x) => x.operacao === "Etiquetar")!;
    expect(caps.maquinas).toBe(1); expect(caps.nominal).toBeCloseTo(97500, 4);                              // só E15
    const montada = montarEntradaEscala(sem.estadoVirtual, AGORA);
    expect(gerarEscala(montada.entrada).alocacoes.some((a) => a.maquinaId === "E16")).toBe(false);
    const com = resolverRotas(estadoF({ selecao: { ...SEL_F, "f-etiq": ["E15", "E16"] } }), AGORA)!;
    expect(com.produtos[F].plano.final).toBeCloseTo(116625, 4);
    const m2 = montarEntradaEscala(com.estadoVirtual, AGORA);
    expect(gerarEscala(m2.entrada).alocacoes.some((a) => a.maquinaId === "E16")).toBe(true);
    const de = resolverRotas(estadoF({ selecao: { ...SEL_F, "f-etiq": ["E15"] } }), AGORA)!;               // desmarca: some imediatamente
    expect(gerarEscala(montarEntradaEscala(de.estadoVirtual, AGORA).entrada).alocacoes.some((a) => a.maquinaId === "E16")).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------------------
// E16 compartilhada: Caixa Amarela (linear) + Conector 3/4" (rotas) com a MESMA máquina selecionada por uma pessoa na Previsão
// ---------------------------------------------------------------------------------------------------------------------------------------------
import { pool, entrada as entradaMotor, equipe, slotsDe, IDS_PERIODOS } from "@/features/escala/__tests__/helpers";
import type { AlocacaoEscala } from "@/features/escala/types";
import { processarSemana, type EscalaIO } from "@/lib/escala/processar";
import type { PayloadAplicacao } from "@/lib/escala/estado";
import { registrosDeDivisao, type RegistroDivisao } from "../resolucao";
import { DIAS } from "./fixtureRotas";

const caixa = (q: number, valor = 50) => ({ produtoId: "pCaixa", quantidade: q, valorUnitario: valor, maquinasPorEtapa: { "c-etiq": ["E16"] } });
const SEL_E16 = { ...SEL_F, "f-etiq": ["E15", "E16"] };
const executar = (q: number, valor = 50, selecao = SEL_E16, extra: Parameters<typeof estadoF>[0] = {}) => {
  const e = estadoF({ selecao, itensExtras: [caixa(q, valor)], etapasExtras: [etapaCaixa()], pessoas: 20, ...extra });
  const r = resolverRotas(e, AGORA)!;
  const montada = montarEntradaEscala(r.estadoVirtual, AGORA);
  const res = gerarEscala(montada.entrada);
  return { e, r, montada, res, real: reverterResultado(res) };
};
const usoE16 = (alocs: AlocacaoEscala[]) => alocs.filter((a) => a.maquinaId === "E16");

describe("M3 — teste crítico E16: Caixa Amarela + Conector 3/4\" disputando a mesma máquina", () => {
  it("nunca dupla contabilização: cada (dia, período) da E16 serve UM produto e UM operador; no máximo 30 períodos; invariantes do motor", () => {
    [14100, 40000, 60000, 70500].forEach((q) => {
      const { montada, res, real } = executar(q);
      expect(checarInvariantes(montada.entrada, res)).toEqual([]);
      const uso = usoE16(real.alocacoes);
      const slots = uso.map((a) => `${a.data}|${a.periodoId}`);
      expect(new Set(slots).size).toBe(slots.length);                       // período de máquina consumido uma vez só
      expect(uso.length).toBeLessThanOrEqual(30);                           // 5 dias × 6 períodos
      const pessoas = uso.map((a) => `${a.data}|${a.periodoId}|${a.funcionarioId}`);
      expect(new Set(pessoas).size).toBe(pessoas.length);
      // a soma das peças creditadas à E16 respeita a meta de cada período (nada acima da capacidade real da máquina)
      const metaF = 3250, metaCaixa = 2350;                                  // médias dos períodos (Etiquetar F 3500/3000; Caixa 2500/2200)
      expect(uso.reduce((s, a) => s + a.pecas, 0)).toBeLessThanOrEqual(30 * Math.max(metaF, metaCaixa) + 1e-6);
    });
  });
  it("decisão busca atendimento global: com 60.000 na Caixa a Caixa COMPLETA e o Conector recebe o resto de períodos (não fica tudo para um só)", () => {
    const { real, r } = executar(60000);
    const uso = usoE16(real.alocacoes);
    const doConector = uso.filter((a) => a.produtoId === F).length, daCaixa = uso.filter((a) => a.produtoId === "pCaixa").length;
    expect(doConector).toBeGreaterThan(0); expect(daCaixa).toBeGreaterThan(0); expect(doConector + daCaixa).toBeLessThanOrEqual(30);
    expect((real.pecasRestantes["pCaixa|c-etiq"] ?? 0)).toBeLessThan(1);      // Caixa atendida por inteiro
    expect(r.produtos[F].plano.final).toBeGreaterThan(97500);                 // o Conector passa de 97.500 só pelo que sobrou da E16
  });
  it("LUCRO/HORA NÃO DOMINA: a divisão da E16 é a mesma com a Caixa valendo R$ 50 ou R$ 0,01 por peça", () => {
    const a = executar(60000, 50), b = executar(60000, 0.01);
    const cont = (x: typeof a, p: string) => usoE16(x.real.alocacoes).filter((y) => y.produtoId === p).length;
    expect(cont(a, F)).toBe(cont(b, F)); expect(cont(a, "pCaixa")).toBe(cont(b, "pCaixa"));
  });
  it("6 períodos no motor, CARACTERIZAÇÃO (motor atual, inalterado): cabendo os dois ⇒ 2 + 4; senão as FALTAS se igualam (1 + 5); a prévia usa a mesma regra; preço nunca decide", () => {
    const motor = (qCaixa: number, qF: number, vCaixa: number, vF: number) => {
      const e = entradaMotor({
        pools: [
          pool({ produto: "pCaixa", etapa: "c-etiq", op: "opEtiq", q: qCaixa, maquinas: ["E16"], mu: 2500, valor: vCaixa }),
          pool({ produto: idVirtual(F, CADEIA_COMUM), etapa: "f-etiq", op: "opEtiq", q: qF, maquinas: ["E16"], mu: 3250, valor: vF }),
        ],
        funcionarios: equipe(6), revezamentoDuro: true,
      });
      const r = gerarEscala(e);
      expect(checarInvariantes(e, r)).toEqual([]);
      const n = (p: string) => r.alocacoes.filter((a) => a.maquinaId === "E16" && a.produtoId === p).length;
      expect(n("pCaixa") + n(idVirtual(F, CADEIA_COMUM))).toBeLessThanOrEqual(IDS_PERIODOS.length);          // 6 períodos, cada um usado uma vez
      return { caixa: n("pCaixa"), conector: n(idVirtual(F, CADEIA_COMUM)) };
    };
    // Caixa precisa de 2 períodos, Conector de 4: cabem os dois — nenhum "rouba" do outro, com qualquer ordem de preço
    [[100, 1], [1, 100]].forEach(([vc, vf]) => expect(motor(5000, 13000, vc, vf)).toEqual({ caixa: 2, conector: 4 }));
    // Conector precisa de 6 (Caixa 2): não cabem — as faltas se igualam (1 período de falta cada) e o preço não muda isso
    [[100, 1], [1, 100]].forEach(([vc, vf]) => expect(motor(5000, 19500, vc, vf)).toEqual({ caixa: 1, conector: 5 }));
    // a PRÉVIA estima do mesmo jeito (horas de máquina = períodos): pedidos 2 e 6 ⇒ 1 e 5; 2 e 8 ⇒ 0 e 6; 2 e 4 ⇒ 2 e 4
    const rep = (a: number, b: number) => { const m = repartirMaquina(6, [{ itemId: "caixa", horas: a }, { itemId: "conector", horas: b }]); return [m.get("caixa"), m.get("conector")]; };
    expect(rep(2, 6)).toEqual([1, 5]); expect(rep(2, 8)).toEqual([0, 6]); expect(rep(2, 4)).toEqual([2, 4]);
    // DIVERGÊNCIA registrada: o exemplo conceitual "Caixa 2 + Conector 4" quando o Conector não completaria nem com os 6 NÃO é o que o motor atual faz (ele dá os 6 ao mais atrasado). Fica como decisão do usuário.
    expect(motor(5000, 26000, 100, 1)).toEqual({ caixa: 0, conector: 6 });
  });
  it("retirar a E16 do Conector na Previsão remove IMEDIATAMENTE a possibilidade de uso; a Caixa passa a ter a máquina inteira", () => {
    const com = executar(60000);
    const sem = executar(60000, 50, SEL_F);                                     // E16 fora da seleção do Conector (E15 só)
    expect(usoE16(com.real.alocacoes).some((a) => a.produtoId === F)).toBe(true);
    expect(usoE16(sem.real.alocacoes).some((a) => a.produtoId === F)).toBe(false);
    expect(sem.r.produtos[F].plano.final).toBeCloseTo(97500, 4);
    expect(sem.r.produtos[F].previa.compartilhadas).toHaveLength(0);             // sem E16 marcada não há máquina compartilhada na prévia
  });
  it("revezamento duro atravessa as cadeias: mesma operacao_id nunca em períodos consecutivos para a mesma pessoa (Etiquetar do Conector e da Caixa contam como a mesma operação)", () => {
    const { real } = executar(40000);
    const ordem = IDS_PERIODOS;
    const porPessoaDia = new Map<string, AlocacaoEscala[]>();
    real.alocacoes.filter((a) => a.maquinaId).forEach((a) => { const k = `${a.funcionarioId}|${a.data}`; porPessoaDia.set(k, [...(porPessoaDia.get(k) ?? []), a]); });
    let repeticoes = 0;
    porPessoaDia.forEach((l) => { l.sort((a, b) => ordem.indexOf(a.periodoId) - ordem.indexOf(b.periodoId)); l.forEach((a, i) => { const ant = l[i - 1]; if (ant && ordem.indexOf(a.periodoId) === ordem.indexOf(ant.periodoId) + 1 && a.operacaoId === ant.operacaoId) repeticoes++; }); });
    expect(repeticoes).toBe(0);
    expect(real.alocacoes.some((a) => a.excecaoRevezamento)).toBe(false);
  });
});

describe("M3 — feedback da Escala (capacidade realizável) e convergência", () => {
  const quintaSemMaquina = [{ maquinaId: "A8", desdeMs: 0, liberadaEm: null as string | null }];
  const comA8Parada = (extra: Parameters<typeof estadoF>[0] = {}) => {
    const e = estadoF({ pessoas: 20, ...extra });
    e.indisponibilidades = [{ maquinaId: "A8", desde: "2026-11-05T03:00:00.000Z", liberadaEm: null }];   // A8 cai na quinta 00:00 (SP) até o fim da semana
    return e;
  };
  void quintaSemMaquina;
  it("AUTO nominal 35.625 mas realizável 21.375 (3 dias): a CONV compensa SÓ com as máquinas que a pessoa marcou; converge na 2ª rodada", () => {
    const e = comA8Parada();
    const r = resolverRotas(e, AGORA)!, p = r.produtos[F];
    expect(p.rodadas).toHaveLength(2); expect(p.parada).toBe("atendeu_alvo"); expect(p.convergiu).toBe(true);
    const [r1, r2] = p.rodadas;
    expect(r1.alvo.AUTO).toBeCloseTo(35625, 4); expect(r1.capacidadeNominalPorRota.AUTO).toBeCloseTo(35625, 4); expect(r1.capacidadeRealizavelPorRota.AUTO).toBeCloseTo(21375, 0);
    expect(r1.faltaDeEntrega).toBe(true); expect(r2.tetos["f-rp"]).toBeCloseTo(21375, 0);
    expect(r2.alvo.AUTO).toBeCloseTo(21375, 0); expect(r2.alvo.CONV).toBeCloseTo(97500 - 21375, 0);     // diferença de 14.250 foi para a CONV
    expect(r2.faltaDeEntrega).toBe(false); expect(r2.finalRealizavel).toBeCloseTo(97500, 0);
    expect(r2.capacidadeRealizavelPorRota.AUTO).toBeCloseTo(21375, 0); expect(r2.capacidadeNominalPorRota.AUTO).toBeCloseTo(35625, 4);   // a limitação descoberta na rodada 1 continua valendo
    // auditoria: hashes diferentes entre rodadas (a entrada mudou: tetos), reproduzíveis (mesma entrada ⇒ mesmo hash)
    expect(r1.hashEntradaPlanejador).not.toBe(r2.hashEntradaPlanejador); expect(r1.hashEntradaEscala).not.toBe(r2.hashEntradaEscala);
    const de = resolverRotas(comA8Parada(), AGORA)!.produtos[F];
    expect(de.rodadas.map((x) => x.hashEntradaPlanejador)).toEqual(p.rodadas.map((x) => x.hashEntradaPlanejador));
    expect(de.rodadas.map((x) => x.hashEntradaEscala)).toEqual(p.rodadas.map((x) => x.hashEntradaEscala));
    // nunca máquina não selecionada: P11/P12/R5 são compatíveis no cadastro e NÃO foram marcadas
    const res = reverterResultado(gerarEscala(montarEntradaEscala(r.estadoVirtual, AGORA).entrada));
    const usadas = new Set(res.alocacoes.map((a) => a.maquinaId).filter(Boolean));
    ["P11", "P12", "R5", "E16"].forEach((m) => expect(usadas.has(m)).toBe(false));
  });
  it("compensação impossível dentro do selecionado: sem máquinas CONV marcadas a CONV não é inventada — o final cai e o diagnóstico mostra o realizável", () => {
    const e = comA8Parada({ selecao: { ...SEL_F, "f-rosq": [], "f-para": [] } });
    const p = resolverRotas(e, AGORA)!.produtos[F];
    expect(p.plano.alvo.CONV ?? 0).toBe(0);
    expect(p.plano.final).toBeCloseTo(21375, 0);
    expect(p.rodadas.at(-1)!.faltaDeEntrega).toBe(false);                      // o plano final cabe no que a Escala realiza
  });
  it("limite de rodadas: com 1 rodada a divisão NÃO converge — nada é inventado, devolve diagnóstico (convergiu=false)", () => {
    const e = comA8Parada({ rotas: { maxRodadas: 1 } });
    const p = resolverRotas(e, AGORA)!.produtos[F];
    expect(p.rodadas).toHaveLength(1); expect(p.parada).toBe("limite_rodadas"); expect(p.convergiu).toBe(false);
    expect(p.diagnostico.join(" ")).toMatch(/não convergiu/); expect(p.diagnostico.join(" ")).toMatch(/Rosquear \+ Parafusar/);
    expect(p.plano.alvo.AUTO).toBeCloseTo(35625, 4);                           // o plano nominal da rodada não foi "consertado" às escondidas
  });
  it("contenção pesada na E16 (Caixa ocupa a máquina toda): converge para baixo rodada a rodada e, se 3 não bastam, informa que não convergiu", () => {
    const { r } = executar(70500);
    const p = r.produtos[F];
    expect(p.rodadas.length).toBeLessThanOrEqual(3);
    const finais = p.rodadas.map((x) => x.finalPlanejado);
    expect([...finais].sort((a, b) => b - a)).toEqual(finais);                // monotonicamente não crescente (só os tetos mudam)
    if (!p.convergiu) { expect(p.parada).toBe("limite_rodadas"); expect(p.diagnostico.length).toBeGreaterThan(0); }
  });
});

describe("M3 — processarSemana com produto de rotas (IO em memória) e divisão registrada", () => {
  it("grava alocações SÓ com o produto real, nunca cadeias virtuais; registra a divisão (rodadas, hashes, alvo, nominal×realizável) e marca a rodada final", async () => {
    const e = estadoF({ itensExtras: [caixa(14100)], etapasExtras: [etapaCaixa()], pessoas: 20, selecao: SEL_E16 });
    e.indisponibilidades = [{ maquinaId: "A8", desde: "2026-11-05T03:00:00.000Z", liberadaEm: null }];
    const gravados: RegistroDivisao[][] = []; let payload: PayloadAplicacao | null = null;
    const io: EscalaIO = {
      carregarEstado: async () => e,
      aplicar: async (p) => { payload = p; return { versoes: Object.fromEntries(DIAS.map((d) => [d, 1])) }; },
      gravarDivisaoRotas: async (rs) => { gravados.push(rs); },
    };
    const out = await processarSemana(io, { agoraMs: AGORA, criarSeNaoExiste: true });
    expect(out.status).toBe("processado");
    const alocs = (payload as unknown as PayloadAplicacao).alocacoes;
    expect(alocs.length).toBeGreaterThan(0);
    expect(alocs.every((a) => !ehVirtual(a.produtoId))).toBe(true);
    expect(new Set(alocs.filter((a) => a.produtoId).map((a) => a.produtoId))).toEqual(new Set([F, "pCaixa"]));
    expect(gravados).toHaveLength(1);
    const rows = gravados[0];
    expect(new Set(rows.map((x) => x.rodada))).toEqual(new Set([1, 2]));
    expect(rows.filter((x) => x.rodadaFinal).every((x) => x.rodada === 2)).toBe(true);
    expect(rows.every((x) => x.produtoId === F && x.semanaInicio === "2026-11-02" && /^[0-9a-f]{64}$/.test(x.hashEntrada) && /^[0-9a-f]{64}$/.test(x.hashEscala) && x.algoritmoVersao.startsWith("rotas-planejador"))).toBe(true);
    const auto1 = rows.find((x) => x.rodada === 1 && x.rotaCodigo === "AUTO")!;
    expect(auto1.capacidadeNominal).toBeCloseTo(35625, 2); expect(auto1.capacidadeRealizavel).toBeCloseTo(21375, 0);
    expect(registrosDeDivisao(e, resolverRotas(e, AGORA)!)).toHaveLength(rows.length);
  });
  it("semana só de produtos LINEARES: nada de divisão, nada de adaptador (resultado idêntico ao do motor direto)", async () => {
    const linear = estadoF();
    linear.rotas = undefined; linear.itens = [caixa(14100)]; linear.etapas = [etapaCaixa()];
    let chamou = 0; let payload: PayloadAplicacao | null = null;
    const io: EscalaIO = { carregarEstado: async () => linear, aplicar: async (p) => { payload = p; return { versoes: {} }; }, gravarDivisaoRotas: async () => { chamou++; } };
    await processarSemana(io, { agoraMs: AGORA, criarSeNaoExiste: true });
    expect(chamou).toBe(0);
    const direto = gerarEscala(montarEntradaEscala(linear, AGORA).entrada);
    expect(JSON.stringify((payload as unknown as PayloadAplicacao).alocacoes)).toBe(JSON.stringify(direto.alocacoes));
  });
});
void slotsDe;
