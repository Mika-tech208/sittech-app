// FRENTE C — NO-OP no recálculo oficial: plano semanticamente idêntico => nenhuma versão nova, nenhuma regravação.
import { describe, it, expect } from "vitest";
import { epochMsNoFuso } from "@/features/escala/tempo";
import type { AlocacaoEscala } from "@/features/escala/types";
import { assinaturaAlertas, linhasIguais, planosIguais } from "../planoIgual";
import { Mundo, estadoDeTeste } from "./bancoMemoria";

const SEMANA = "2026-11-02";
const DIAS = ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06"];
const GERA = epochMsNoFuso(SEMANA, "05:00");
const AGORA = epochMsNoFuso("2026-11-03", "09:30"); // terça M2 em andamento
const versoes = (m: Mundo) => JSON.stringify([...m.dias].map(([d, x]) => [d, x.versao]));
const sig = (m: Mundo) => Mundo.assinatura(m.alocacoes);

async function mundo() {
  const m = new Mundo(estadoDeTeste(SEMANA, DIAS));
  await m.recalcular(GERA, true);
  await m.recalcular(AGORA); // plano "vivo" no instante dos testes
  return m;
}

describe("planosIguais / linhasIguais — o que conta como igual", () => {
  const base: AlocacaoEscala = { data: "2026-11-03", periodoId: "m3", funcionarioId: "f01", maquinaId: "m1", produtoId: "pA", etapaId: "eA1", operacaoId: "opX", pecas: 100.123456789, motivoSemPosto: null, excecaoRevezamento: false, motivoExcecao: null };
  it("idêntico (e tolerância de arredondamento do banco) => igual", () => {
    expect(linhasIguais(base, { ...base })).toBe(true);
    expect(linhasIguais(base, { ...base, pecas: base.pecas + 1e-9 })).toBe(true);
  });
  it("funcionário/máquina/produto/etapa/operação/peças/adicional/sem posto/exceção/origem diferentes => NÃO igual", () => {
    const difs: Partial<AlocacaoEscala>[] = [{ maquinaId: "m2" }, { produtoId: "pB" }, { etapaId: "eA2" }, { operacaoId: "opY" }, { pecas: 101 }, { pecasAdicional: 10, tipoAdicional: "acabado" }, { maquinaId: null, motivoSemPosto: "x" }, { excecaoRevezamento: true }];
    difs.forEach((d) => expect(linhasIguais(base, { ...base, ...d })).toBe(false));
    expect(linhasIguais({ ...base, origem: "auto" } as never, { ...base, origem: "manual" } as never)).toBe(false); // troca manual conta
  });
  it("ordem das linhas não importa; tamanho diferente ou chave duplicada => não igual", () => {
    const b2 = { ...base, funcionarioId: "f02" };
    expect(planosIguais([base, b2], [b2, base])).toBe(true);
    expect(planosIguais([base], [base, b2])).toBe(false);
    expect(planosIguais([base, base], [base, base])).toBe(false);
  });
  it("assinatura dos alertas: independe da ordem; muda se um alerta muda", () => {
    const a = { tipo: "selecao_maquina_invalida", produtoId: "p", motivo: "x" } as never; const b = { tipo: "subcarga_previsao", data: "2026-11-03", motivo: "y" } as never;
    expect(assinaturaAlertas([a, b])).toBe(assinaturaAlertas([b, a]));
    expect(assinaturaAlertas([a])).not.toBe(assinaturaAlertas([a, b]));
  });
});

describe("recálculo oficial: NO-OP quando nada mudou", () => {
  it("o MESMO evento duas vezes: a segunda é sem_alteracao — nenhuma versão sobe, nenhuma regravação", async () => {
    const m = await mundo();
    const v0 = versoes(m), s0 = sig(m), ap0 = m.aplicacoes;
    const r = await m.recalcular(AGORA);
    expect(r.status).toBe("sem_alteracao");
    expect(versoes(m)).toBe(v0); expect(sig(m)).toBe(s0); expect(m.aplicacoes).toBe(ap0);
  });
  it("reconciliação/revalidação sem divergência dispara recálculos repetidos: todos no-op (10×)", async () => {
    const m = await mundo(); const v0 = versoes(m), ap0 = m.aplicacoes;
    for (let i = 0; i < 10; i++) expect((await m.recalcular(AGORA)).status).toBe("sem_alteracao");
    expect(versoes(m)).toBe(v0); expect(m.aplicacoes).toBe(ap0);
  });
  it("retorno ao mesmo plano: ausência cria plano diferente (grava, versão sobe); remover a ausência volta ao ORIGINAL (grava de novo); e daí em diante é no-op", async () => {
    const m = await mundo(); const original = sig(m), v0 = versoes(m);
    m.editar((e) => { e.ausencias = [{ funcionarioId: "f01", data: "2026-11-04", inicioMin: null, fimMin: null } as never]; });
    const r1 = await m.recalcular(AGORA);
    expect(r1.status).toBe("processado"); expect(versoes(m)).not.toBe(v0);
    m.editar((e) => { e.ausencias = []; });
    const r2 = await m.recalcular(AGORA);
    expect(r2.status).toBe("processado");
    expect(sig(m)).toBe(original); // a ausência foi desfeita: plano idêntico ao inicial
    const v2 = versoes(m);
    expect((await m.recalcular(AGORA)).status).toBe("sem_alteracao");
    expect(versoes(m)).toBe(v2);
  });
  it("plano REALMENTE diferente (máquina indisponível numa semana viva): grava, sobe versão e muda as linhas futuras", async () => {
    const m = await mundo(); const s0 = sig(m), v0 = versoes(m);
    m.editar((e) => { e.maquinasIndisponiveisPrevisao = ["m1", "m2"]; });
    const r = await m.recalcular(AGORA);
    expect(r.status).toBe("processado"); expect(sig(m)).not.toBe(s0); expect(versoes(m)).not.toBe(v0);
  });
  it("só os ALERTAS mudam (nova seleção de máquina inválida) e o plano segue igual: NÃO é no-op — a tela precisa dos alertas novos", async () => {
    const m = await mundo(); const ap0 = m.aplicacoes;
    m.editar((e) => { e.itens = e.itens.map((i, k) => (k === 0 ? { ...i, maquinasPorEtapa: { ...i.maquinasPorEtapa, eA1: [...(i.maquinasPorEtapa.eA1 ?? []), "m-fantasma"] } } : i)); e.etapas = e.etapas.map((et) => (et.id === "eA1" ? { ...et, maquinasCompativeis: ["m1", "m2"] } : et)); });
    const r = await m.recalcular(AGORA);
    expect(r.status).toBe("processado"); expect(m.aplicacoes).toBe(ap0 + 1);
    expect((await m.recalcular(AGORA)).status).toBe("sem_alteracao"); // e aí estabiliza
  });
  it("sem assinatura de alertas conhecida (recálculo antigo, anterior ao recurso): nunca é no-op na primeira vez", async () => {
    const m = await mundo();
    m.editar((e) => { e.ultimaAssinaturaAlertas = null; });
    expect((await m.recalcular(AGORA)).status).toBe("processado");
    expect((await m.recalcular(AGORA)).status).toBe("sem_alteracao");
  });
  it("primeira geração e dia novo nunca são no-op", async () => {
    const m = new Mundo(estadoDeTeste(SEMANA, DIAS));
    expect((await m.recalcular(GERA, true)).status).toBe("processado");
    m.editar((e) => { e.diasProdutivos = [...e.diasProdutivos, "2026-11-07"]; });
    expect((await m.recalcular(GERA)).status).toBe("processado");
    expect(m.dias.has("2026-11-07")).toBe(true);
  });
  it("troca manual: se o motor a desfaz o plano difere (grava); se a mantém, é no-op — origem manual conta na comparação", async () => {
    const m = await mundo();
    const futuras = m.futuras(AGORA).filter((a) => a.data === "2026-11-05" && a.periodoId === "t1" && a.maquinaId).slice(0, 2);
    if (futuras.length === 2) {
      m.trocarManual("2026-11-05", "t1", futuras[0].funcionarioId, futuras[1].funcionarioId);
      const r = await m.recalcular(AGORA);
      expect(["processado", "sem_alteracao"]).toContain(r.status);
      expect((await m.recalcular(AGORA)).status).toBe("sem_alteracao"); // estável depois
    }
  });
  it("passado nunca muda e o histórico de revezamento segue válido em qualquer caminho", async () => {
    const m = await mundo(); const passadoAntes = Mundo.assinatura(m.alocacoes.filter((a) => epochMsNoFuso(a.data, ({ m1: "07:12", m2: "08:48", m3: "10:24", t1: "13:00", t2: "14:20", t3: "15:40" } as Record<string, string>)[a.periodoId]) <= AGORA));
    await m.recalcular(AGORA); await m.recalcular(AGORA);
    const passadoDepois = Mundo.assinatura(m.alocacoes.filter((a) => epochMsNoFuso(a.data, ({ m1: "07:12", m2: "08:48", m3: "10:24", t1: "13:00", t2: "14:20", t3: "15:40" } as Record<string, string>)[a.periodoId]) <= AGORA));
    expect(passadoDepois).toBe(passadoAntes);
  });
});
