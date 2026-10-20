import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { PERIODOS_REAIS } from "@/features/escala/__tests__/helpers";
import { epochMsNoFuso } from "@/features/escala/tempo";
import type { HistoricoEquidadeFuncionario } from "@/features/escala/types";
import { ConflitoDeVersaoError, type EstadoBruto, type PayloadAplicacao } from "../estado";
import { contextoSemanaSP, gerarEscalaSemanal, MENSAGEM_SEM_PREVISAO, type DepsGeracaoSemanal } from "../geracaoSemanal";
import { processarSemana, type EscalaIO } from "../processar";

const SEG = "2026-10-26"; // segunda-feira
const TER = "2026-10-27";
const METAS = { m1: 100, m2: 100, m3: 100, t1: 100, t2: 100, t3: 100 };
const segunda0630 = epochMsNoFuso(SEG, "06:30");

// ---- "banco" em memória com a mesma regra de versão da RPC escala_aplicar_recalculo ----
function criarBanco(opcoes: { previsao?: boolean; escalaExistente?: boolean; historico?: HistoricoEquidadeFuncionario[]; itens?: EstadoBruto["itens"] } = {}) {
  const b = {
    previsaoId: opcoes.previsao === false ? null : "prev1",
    dias: new Map<string, { versao: number }>(),
    aplicacoesGravadas: 0,
    payloads: [] as PayloadAplicacao[],
    erros: [] as string[],
    geradas: 0,
    chamadasGerar: 0,
    agora: undefined as number | undefined,
  };
  if (opcoes.escalaExistente) {
    b.dias.set(SEG, { versao: 4 });
    b.dias.set(TER, { versao: 4 });
  }
  const estado = (): EstadoBruto => ({
    previsaoId: "prev1",
    semanaInicio: SEG,
    diasProdutivos: [SEG, TER],
    periodosAtuais: PERIODOS_REAIS,
    diasExistentes: [...b.dias.entries()].map(([data, d]) => ({ data, versao: d.versao, periodosSnapshot: PERIODOS_REAIS })),
    equipeProdutiva: [{ funcionarioId: "f1", ativo: true }, { funcionarioId: "f2", ativo: true }, { funcionarioId: "f3", ativo: true }, { funcionarioId: "f4", ativo: true }],
    itens: opcoes.itens ?? [
      { produtoId: "pA", quantidade: 100000, valorUnitario: 1, maquinasPorEtapa: { eA: ["mA"] } },
      { produtoId: "pB", quantidade: 100000, valorUnitario: 1, maquinasPorEtapa: { eB: ["mB"] } },
    ],
    etapas: [
      { id: "eA", produtoId: "pA", operacaoId: "opA", ordem: 1, metas: METAS },
      { id: "eB", produtoId: "pB", operacaoId: "opB", ordem: 1, metas: METAS },
    ],
    maquinasIndisponiveisPrevisao: [],
    maquinasInativas: [],
    ausencias: [],
    indisponibilidades: [],
    alocacoes: [],
    nomesOperacao: {},
    historicoEquidade: opcoes.historico,
  });
  const io: EscalaIO = {
    async carregarEstado() {
      const e = estado();
      await Promise.resolve(); // cede a vez: duas chamadas simultâneas leem ANTES de qualquer aplicação
      await Promise.resolve();
      return e;
    },
    async aplicar(p) {
      b.payloads.push(p);
      // serializa por semana (advisory lock) e valida a versão de cada dia
      for (const d of p.dias) {
        const atual = b.dias.get(d.data);
        if (d.versao_base === null && atual) throw new ConflitoDeVersaoError(`ESCALA_VERSAO_CONFLITO: dia ${d.data} já existe`);
        if (d.versao_base !== null && (!atual || atual.versao !== d.versao_base)) throw new ConflitoDeVersaoError(`ESCALA_VERSAO_CONFLITO: dia ${d.data}`);
      }
      p.dias.forEach((d) => b.dias.set(d.data, { versao: (d.versao_base ?? 0) + 1 }));
      b.aplicacoesGravadas++;
      return { versoes: Object.fromEntries([...b.dias.entries()].map(([k, v]) => [k, v.versao])) };
    },
  };
  const deps: DepsGeracaoSemanal = {
    async resolverPrevisao() { return b.previsaoId; },
    async semanaTemEscala() { return b.dias.size > 0; },
    async gerar(_id) {
      b.chamadasGerar++;
      return processarSemana(io, { agoraMs: b.agora ?? segunda0630, criarSeNaoExiste: true, somenteSeNaoExiste: true });
    },
    async registrarErro(_s, mensagem) { b.erros.push(mensagem); },
    async registrarGerada() { b.geradas++; },
  };
  return Object.assign(b, { deps, io });
}

describe("geração semanal — fuso e semana (America/Sao_Paulo)", () => {
  it("segunda 06:30 em São Paulo é segunda e a semana atual começa nela", () => {
    const c = contextoSemanaSP(segunda0630);
    expect(c.diaDaSemana).toBe(1);
    expect(c.semanaInicio).toBe(SEG);
    expect(c.minutosDoDia).toBe(6 * 60 + 30);
    // 06:30 SP = 09:30 UTC (UTC-3)
    expect(new Date(segunda0630).toISOString()).toBe("2026-10-26T09:30:00.000Z");
  });

  it("domingo 23:30 em São Paulo (já segunda em UTC) continua sendo DOMINGO da semana anterior", () => {
    const domingoNoite = epochMsNoFuso("2026-10-25", "23:30");
    expect(new Date(domingoNoite).toISOString().slice(0, 10)).toBe("2026-10-26"); // UTC já virou
    const c = contextoSemanaSP(domingoNoite);
    expect(c.diaDaSemana).toBe(0);
    expect(c.semanaInicio).toBe("2026-10-19");
  });
});

describe("geração semanal — regras", () => {
  it("1: segunda 06:30 com Previsão válida gera a escala (todos os dias, a partir do primeiro período)", async () => {
    const b = criarBanco();
    const r = await gerarEscalaSemanal(b.deps, segunda0630);
    expect(r.status).toBe("gerada");
    expect(b.dias.size).toBe(2);
    expect(b.aplicacoesGravadas).toBe(1);
    expect(b.geradas).toBe(1);
    const p = b.payloads[0];
    expect(p.alocacoes.length).toBe(4 * 6 * 2); // 4 funcionários × 6 períodos × 2 dias
    expect(p.alocacoes.some((a) => a.data === SEG && a.periodoId === "m1")).toBe(true);
  });

  it("2: chamada duplicada (retry do GitHub) não gera duas vezes e não altera nada", async () => {
    const b = criarBanco();
    expect((await gerarEscalaSemanal(b.deps, segunda0630)).status).toBe("gerada");
    const versoes = JSON.stringify([...b.dias.entries()]);
    const r2 = await gerarEscalaSemanal(b.deps, segunda0630 + 60 * 60 * 1000);
    expect(r2.status).toBe("ja_existe");
    expect(b.aplicacoesGravadas).toBe(1);
    expect(JSON.stringify([...b.dias.entries()])).toBe(versoes);
    expect(b.chamadasGerar).toBe(1); // nem tentou gerar de novo
  });

  it("3: escala já existente responde idempotente sem sequer chamar o gerador", async () => {
    const b = criarBanco({ escalaExistente: true });
    const r = await gerarEscalaSemanal(b.deps, segunda0630);
    expect(r).toEqual({ status: "ja_existe", semanaInicio: SEG });
    expect(b.chamadasGerar).toBe(0);
    expect(b.aplicacoesGravadas).toBe(0);
    expect(b.dias.get(SEG)?.versao).toBe(4);
  });

  it("4: sem Previsão Semanal registra erro operacional claro e NÃO gera", async () => {
    const b = criarBanco({ previsao: false });
    const r = await gerarEscalaSemanal(b.deps, segunda0630);
    expect(r.status).toBe("sem_previsao");
    expect(b.erros).toEqual([MENSAGEM_SEM_PREVISAO]);
    expect(MENSAGEM_SEM_PREVISAO).toBe("Não foi possível gerar a Escala de Produção da semana porque não existe Previsão Semanal.");
    expect(b.dias.size).toBe(0);
    expect(b.aplicacoesGravadas).toBe(0);
  });

  it("4b: Previsão sem itens com máquinas selecionadas também é erro (não inventa escala)", async () => {
    const b = criarBanco({ itens: [] });
    const r = await gerarEscalaSemanal(b.deps, segunda0630);
    expect(r.status).toBe("previsao_invalida");
    expect(b.erros).toHaveLength(1);
    expect(b.dias.size).toBe(0);
  });

  it("5: domingo (e qualquer dia que não seja segunda em São Paulo) não gera por engano", async () => {
    for (const [data, hhmm] of [["2026-10-25", "06:30"], ["2026-10-25", "23:30"], ["2026-10-27", "00:30"], ["2026-10-28", "06:30"], ["2026-10-31", "06:30"]] as const) {
      const b = criarBanco();
      const r = await gerarEscalaSemanal(b.deps, epochMsNoFuso(data, hhmm));
      expect(r.status).toBe("fora_da_janela");
      expect(b.dias.size).toBe(0);
      expect(b.chamadasGerar).toBe(0);
      expect(b.erros).toHaveLength(0);
    }
    // segunda o dia inteiro (fuso de SP) vale: 00:10 e 22:00
    for (const hhmm of ["00:10", "22:00"]) {
      const b = criarBanco();
      expect((await gerarEscalaSemanal(b.deps, epochMsNoFuso(SEG, hhmm))).status).toBe("gerada");
    }
  });

  it("7: duas chamadas simultâneas geram uma única escala", async () => {
    const b = criarBanco();
    const [r1, r2] = await Promise.all([gerarEscalaSemanal(b.deps, segunda0630), gerarEscalaSemanal(b.deps, segunda0630)]);
    expect([r1.status, r2.status].sort()).toEqual(["gerada", "ja_existe"]);
    expect(b.aplicacoesGravadas).toBe(1);
    expect(b.dias.get(SEG)?.versao).toBe(1);
    expect(b.dias.size).toBe(2);
    expect(b.geradas).toBe(1);
  });

  it("7b: três chamadas simultâneas continuam gerando uma única escala", async () => {
    const b = criarBanco();
    const rs = await Promise.all([1, 2, 3].map(() => gerarEscalaSemanal(b.deps, segunda0630)));
    expect(rs.filter((r) => r.status === "gerada")).toHaveLength(1);
    expect(rs.filter((r) => r.status === "ja_existe")).toHaveLength(2);
    expect(b.aplicacoesGravadas).toBe(1);
  });

  it("9: a escala gerada aplica a equidade histórica (histórico invertido => atribuição diferente)", async () => {
    const h = (id: string, a: number, bb: number): HistoricoEquidadeFuncionario => ({ funcionarioId: id, periodosDisponiveis: 100, porOperacao: { opA: a, opB: bb }, porMaquina: {} });
    const primeiroSlot = (b: ReturnType<typeof criarBanco>) => b.payloads[0].alocacoes.filter((a) => a.data === SEG && a.periodoId === "m1" && a.maquinaId).map((a) => `${a.funcionarioId}:${a.operacaoId}`).sort();
    // f1,f2 fizeram muita opA; f3,f4 muita opB
    const b1 = criarBanco({ historico: [h("f1", 50, 0), h("f2", 50, 0), h("f3", 0, 50), h("f4", 0, 50)] });
    await gerarEscalaSemanal(b1.deps, segunda0630);
    const b2 = criarBanco({ historico: [h("f1", 0, 50), h("f2", 0, 50), h("f3", 50, 0), h("f4", 50, 0)] });
    await gerarEscalaSemanal(b2.deps, segunda0630);
    // quem estava acima em uma operação vai para a outra
    const ops1 = Object.fromEntries(primeiroSlot(b1).map((s) => s.split(":")));
    const ops2 = Object.fromEntries(primeiroSlot(b2).map((s) => s.split(":")));
    expect(ops1.f1).toBe("opB");
    expect(ops1.f3).toBe("opA");
    expect(ops2.f1).toBe("opA");
    expect(ops2.f3).toBe("opB");
  });

  it("10: a retentativa no meio da semana nunca grava períodos já iniciados/concluídos", async () => {
    const b = criarBanco();
    b.agora = epochMsNoFuso(TER, "09:30"); // terça 09:30: M2 em andamento
    const r = await gerarEscalaSemanal(b.deps, b.agora, { semanaAlvo: SEG });
    expect(r.status).toBe("gerada");
    const grav = b.payloads[0].alocacoes;
    expect(grav.some((a) => a.data === SEG)).toBe(false); // segunda inteira já passou
    expect(grav.some((a) => a.data === TER && (a.periodoId === "m1" || a.periodoId === "m2"))).toBe(false);
    expect(grav.some((a) => a.data === TER && a.periodoId === "m3")).toBe(true);
  });

  it("retentativa de semana que não é a atual é ignorada", async () => {
    const b = criarBanco();
    const r = await gerarEscalaSemanal(b.deps, epochMsNoFuso("2026-11-02", "10:00"), { semanaAlvo: SEG });
    expect(r.status).toBe("semana_nao_atual");
    expect(b.dias.size).toBe(0);
  });
});

describe("8: workflow do GitHub Actions (geração semanal)", () => {
  const yml = readFileSync(`${process.cwd()}/.github/workflows/escala-gerar-semana.yml`, "utf8");
  const gatilhos = yml.split("\n").filter((l) => /^\s*- cron:/.test(l)).map((l) => l.replace(/^\s*- cron:\s*/, "").replace(/"/g, ""));

  it("agenda segunda 06:30 de São Paulo = 09:30 UTC (mais duas execuções de segurança, também só na segunda)", () => {
    expect(gatilhos[0]).toBe("30 9 * * 1");
    gatilhos.forEach((g) => expect(g.endsWith(" * * 1")).toBe(true));
  });

  it("não tem outros gatilhos (sem push, sem workflow_dispatch)", () => {
    expect(/^\s*push:/m.test(yml)).toBe(false);
    expect(/workflow_dispatch/.test(yml.replace(/^#.*$/gm, ""))).toBe(false);
  });

  it("usa os secrets corretos e nunca embute segredo/URL", () => {
    expect(yml).toContain("secrets.CRON_SECRET");
    expect(yml).toContain("secrets.ESCALA_GERAR_SEMANA_URL");
    expect(/https?:\/\/[a-z0-9.-]+\.(vercel\.app|com)/i.test(yml.replace(/^#.*$/gm, ""))).toBe(false);
    expect(yml).toContain("Authorization: Bearer");
  });

  it("falha em qualquer HTTP diferente de 200", () => {
    expect(yml).toContain('if [ "${code}" != "200" ]');
    expect(yml).toMatch(/exit 1/);
  });

  it("chama a rota idempotente protegida (cabeçalho em arquivo, não na linha de comando)", () => {
    expect(yml).toContain("-H @headers.txt");
    expect(yml).toContain("concurrency:");
  });
});
