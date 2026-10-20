import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { criarControladorWakeLock, type DocumentoLike, type EstadoWakeLock, type NavegadorWakeLockLike, type SentinelWakeLockLike } from "../tv/wakeLock";

// ---- fakes (sem DOM) ----
function criarSentinel() {
  const ouvintes: (() => void)[] = [];
  const s = {
    released: false,
    releases: 0,
    async release() { s.released = true; s.releases++; },
    addEventListener(_t: "release", fn: () => void) { ouvintes.push(fn); },
    // o navegador libera o lock (aba oculta, economia de energia…)
    liberarPeloNavegador() { s.released = true; ouvintes.forEach((f) => f()); },
  };
  return s as SentinelWakeLockLike & typeof s;
}

function criarNav(modo: "ok" | "rejeita" | "lanca" = "ok") {
  const state = { chamadas: [] as string[], sentinels: [] as ReturnType<typeof criarSentinel>[], modo };
  const nav: NavegadorWakeLockLike = {
    wakeLock: {
      request(tipo) {
        state.chamadas.push(tipo);
        if (state.modo === "lanca") throw new Error("lançou");
        if (state.modo === "rejeita") return Promise.reject(Object.assign(new Error("NotAllowedError"), { name: "NotAllowedError" }));
        const s = criarSentinel();
        state.sentinels.push(s);
        return Promise.resolve(s);
      },
    },
  };
  return { nav, state };
}

function criarDoc(inicial: "visible" | "hidden" = "visible") {
  const ouvintes = new Map<string, (() => void)[]>();
  const doc: DocumentoLike & { disparar(t: string): void; visibilityState: string } = {
    visibilityState: inicial,
    addEventListener(t, fn) { ouvintes.set(t, [...(ouvintes.get(t) ?? []), fn]); },
    removeEventListener(t, fn) { ouvintes.set(t, (ouvintes.get(t) ?? []).filter((f) => f !== fn)); },
    disparar(t) { (ouvintes.get(t) ?? []).slice().forEach((f) => f()); },
  };
  return { doc, ouvintes };
}

// agendador manual: guarda as retentativas para o teste disparar quando quiser
function criarAgendador() {
  const fila: { fn: () => void; ms: number; cancelado: boolean }[] = [];
  return {
    fila,
    agendar: (fn: () => void, ms: number) => {
      const item = { fn, ms, cancelado: false };
      fila.push(item);
      return () => { item.cancelado = true; };
    },
    async disparar() {
      const pend = fila.filter((i) => !i.cancelado);
      fila.length = 0;
      pend.forEach((i) => i.fn());
      await tick();
    },
    pendentes: () => fila.filter((i) => !i.cancelado),
  };
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

describe("Wake Lock da TV", () => {
  it("1: API disponível — solicita wake lock 'screen' e informa 'ativo'", async () => {
    const { nav, state } = criarNav();
    const { doc } = criarDoc();
    const estados: EstadoWakeLock[] = [];
    const c = criarControladorWakeLock(nav, doc, (e) => estados.push(e));
    c.iniciar();
    await tick();
    expect(state.chamadas).toEqual(["screen"]);
    expect(estados).toEqual(["ativo"]);
    c.parar();
    expect(state.sentinels[0].released).toBe(true); // devolve o lock ao parar
  });

  it("2: API indisponível — TV continua funcionando (estado 'nao_suportado', sem exceção)", async () => {
    const { doc, ouvintes } = criarDoc();
    const estados: EstadoWakeLock[] = [];
    const c = criarControladorWakeLock({}, doc, (e) => estados.push(e));
    expect(() => c.iniciar()).not.toThrow();
    await tick();
    expect(estados).toEqual(["nao_suportado"]);
    expect((ouvintes.get("visibilitychange") ?? []).length).toBe(0);
    expect(() => c.parar()).not.toThrow();
    // navegador sem objeto navigator (SSR/teste)
    const c2 = criarControladorWakeLock(undefined, undefined, () => undefined);
    expect(() => { c2.iniciar(); c2.parar(); }).not.toThrow();
  });

  it("3: visibilidade hidden → visible readquire o lock", async () => {
    const { nav, state } = criarNav();
    const { doc } = criarDoc();
    const estados: EstadoWakeLock[] = [];
    const ag = criarAgendador();
    const c = criarControladorWakeLock(nav, doc, (e) => estados.push(e), { agendar: ag.agendar });
    c.iniciar();
    await tick();
    expect(state.chamadas).toHaveLength(1);

    // aba oculta: o navegador libera sozinho
    doc.visibilityState = "hidden";
    state.sentinels[0].liberarPeloNavegador();
    expect(estados.at(-1)).toBe("inativo");
    expect(ag.pendentes()).toHaveLength(0); // oculto: não fica insistindo

    // volta a ficar visível: readquire imediatamente
    doc.visibilityState = "visible";
    doc.disparar("visibilitychange");
    await tick();
    expect(state.chamadas).toHaveLength(2);
    expect(estados.at(-1)).toBe("ativo");
    c.parar();
  });

  it("3b: não readquire enquanto já existe lock ativo (visibilitychange repetido não duplica)", async () => {
    const { nav, state } = criarNav();
    const { doc } = criarDoc();
    const c = criarControladorWakeLock(nav, doc, () => undefined);
    c.iniciar();
    await tick();
    doc.disparar("visibilitychange");
    doc.disparar("visibilitychange");
    await tick();
    expect(state.chamadas).toHaveLength(1);
    c.parar();
  });

  it("3c: retorno de foco da janela também tenta readquirir quando não há lock", async () => {
    const { nav, state } = criarNav();
    const { doc } = criarDoc();
    const janela = criarDoc();
    const c = criarControladorWakeLock(nav, doc, () => undefined, { janela: janela.doc });
    c.iniciar();
    await tick();
    state.sentinels[0].liberarPeloNavegador();
    janela.doc.disparar("focus");
    await tick();
    expect(state.chamadas).toHaveLength(2);
    c.parar();
    expect((janela.ouvintes.get("focus") ?? []).length).toBe(0); // limpou o ouvinte
  });

  it("4: lock liberado pelo navegador — retenta UMA vez com atraso (sem laço agressivo) e o atraso cresce se falhar", async () => {
    const { nav, state } = criarNav();
    const { doc } = criarDoc();
    const ag = criarAgendador();
    const c = criarControladorWakeLock(nav, doc, () => undefined, { agendar: ag.agendar, atrasoInicialMs: 5000, atrasoMaximoMs: 40000 });
    c.iniciar();
    await tick();
    state.sentinels[0].liberarPeloNavegador(); // visível: agenda retentativa
    expect(ag.pendentes()).toHaveLength(1);
    expect(ag.pendentes()[0].ms).toBe(5000);
    expect(state.chamadas).toHaveLength(1); // nada de tentativa imediata em laço

    // as próximas aquisições falham: atraso dobra até o teto
    state.modo = "rejeita";
    await ag.disparar(); // tentativa 2 (falha) → agenda a 10s
    expect(ag.pendentes().map((p) => p.ms)).toEqual([10000]);
    await ag.disparar(); // falha → 20s
    await ag.disparar(); // falha → 40s (teto)
    await ag.disparar(); // falha → continua 40s
    expect(ag.pendentes().map((p) => p.ms)).toEqual([40000]);
    expect(state.chamadas).toHaveLength(1 + 4); // 1 original + 4 retentativas — sempre uma por vez

    // quando volta a funcionar, adquire e zera o backoff
    state.modo = "ok";
    await ag.disparar();
    expect(state.chamadas).toHaveLength(6);
    expect(ag.pendentes()).toHaveLength(0);
    c.parar();
  });

  it("5: nenhuma exceção quebra a página (request rejeita, request lança, release falha, onEstado lança)", async () => {
    for (const modo of ["rejeita", "lanca"] as const) {
      const { nav } = criarNav(modo);
      const { doc } = criarDoc();
      const estados: EstadoWakeLock[] = [];
      const ag = criarAgendador();
      const c = criarControladorWakeLock(nav, doc, (e) => estados.push(e), { agendar: ag.agendar });
      expect(() => c.iniciar()).not.toThrow();
      await tick();
      expect(estados).toContain("erro");
      expect(() => c.parar()).not.toThrow();
    }

    // release que falha no parar()
    const { nav, state } = criarNav();
    const { doc } = criarDoc();
    const c = criarControladorWakeLock(nav, doc, () => { throw new Error("callback com defeito"); });
    c.iniciar();
    await tick();
    state.sentinels[0].release = () => Promise.reject(new Error("falhou ao liberar"));
    state.sentinels[0].released = false;
    expect(() => c.parar()).not.toThrow();
    await tick();
  });

  it("5b: parado enquanto aguardava o request — devolve o lock e não deixa retentativa pendurada", async () => {
    const sentinel = criarSentinel();
    let resolver: (s: SentinelWakeLockLike) => void = () => undefined;
    const nav: NavegadorWakeLockLike = { wakeLock: { request: () => new Promise<SentinelWakeLockLike>((r) => { resolver = r; }) } };
    const { doc } = criarDoc();
    const ag = criarAgendador();
    const c = criarControladorWakeLock(nav, doc, () => undefined, { agendar: ag.agendar });
    c.iniciar();
    c.parar();
    resolver(sentinel);
    await tick();
    expect(sentinel.releases).toBe(1);
    expect(ag.pendentes()).toHaveLength(0);
  });

  it("6: polling e Realtime são independentes do wake lock (a TV não os acopla)", () => {
    const hookTv = readFileSync(`${process.cwd()}/src/hooks/useEscalaTv.ts`, "utf8");
    expect(/wakeLock|WakeLock/.test(hookTv)).toBe(false); // polling/Realtime não dependem dele
    const wake = readFileSync(`${process.cwd()}/src/features/escala/tv/wakeLock.ts`, "utf8");
    // nada de simular interação do usuário
    const semComentarios = wake.replace(/\/\/.*$/gm, "");
    expect(/mousemove|dispatchEvent|\.click\(|KeyboardEvent|MouseEvent|setInterval/.test(semComentarios)).toBe(false);
    const pagina = readFileSync(`${process.cwd()}/src/features/escala/tv/EscalaTvPage.tsx`, "utf8");
    expect(pagina).toContain("useEscalaTv(");
    expect(pagina).toContain("useWakeLockTv(");
  });
});
