// TEMA GLOBAL: a preferência é única, persiste entre rotas/recargas e nenhuma página a redefine.
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { CHAVE_TEMA, criarStoreTema, lerTemaSalvo, SCRIPT_TEMA_INICIAL, TEMA_PADRAO, type ArmazenamentoMinimo } from "@/lib/tema";

const memoria = (inicial: Record<string, string> = {}): ArmazenamentoMinimo & { dados: Record<string, string> } => {
  const dados = { ...inicial };
  return { dados, getItem: (k) => (k in dados ? dados[k] : null), setItem: (k, v) => { dados[k] = v; } };
};

describe("preferência de tema", () => {
  it("sem preferência salva usa o padrão atual do sistema (escuro); valor inválido também", () => {
    expect(TEMA_PADRAO).toBe("dark");
    expect(lerTemaSalvo(memoria())).toBe("dark");
    expect(lerTemaSalvo(memoria({ [CHAVE_TEMA]: "azul" }))).toBe("dark");
    expect(lerTemaSalvo(null)).toBe("dark");
  });
  it("claro persiste entre rotas: qualquer 'página' que monte depois enxerga o mesmo store (e o valor está salvo em sittech-theme)", () => {
    const arm = memoria();
    const store = criarStoreTema(arm);
    store.definir("light"); // Home
    const rotas = ["previsao", "escala", "producao-real", "produtos", "home"];
    rotas.forEach(() => expect(store.obter()).toBe("light"));
    expect(arm.dados[CHAVE_TEMA]).toBe("light");
  });
  it("escuro persiste entre rotas", () => {
    const store = criarStoreTema(memoria());
    store.definir("light");
    store.definir("dark");
    ["previsao", "escala", "producao-real", "produtos", "home"].forEach(() => expect(store.obter()).toBe("dark"));
  });
  it("refresh / reabrir o sistema preserva a preferência (store novo, mesmo armazenamento)", () => {
    const arm = memoria();
    criarStoreTema(arm).definir("light");
    expect(criarStoreTema(arm).obter()).toBe("light");
    criarStoreTema(arm).definir("dark");
    expect(criarStoreTema(arm).obter()).toBe("dark");
  });
  it("alternar com função (como o botão de cada página) e notificar todos os assinantes", () => {
    const store = criarStoreTema(memoria());
    let a = 0, b = 0;
    const sa = store.assinar(() => a++), sb = store.assinar(() => b++);
    store.definir((t) => (t === "dark" ? "light" : "dark"));
    expect(store.obter()).toBe("light");
    expect([a, b]).toEqual([1, 1]);
    sa();
    store.definir((t) => (t === "dark" ? "light" : "dark"));
    expect([a, b]).toEqual([1, 2]);
    sb();
  });
  it("outra aba mudou o tema: sincronizar relê o armazenamento", () => {
    const arm = memoria();
    const store = criarStoreTema(arm);
    let n = 0;
    store.assinar(() => n++);
    arm.dados[CHAVE_TEMA] = "light";
    store.sincronizar();
    expect(store.obter()).toBe("light");
    expect(n).toBe(1);
  });
  it("armazenamento indisponível não quebra (vale só na sessão)", () => {
    const quebrado: ArmazenamentoMinimo = { getItem: () => { throw new Error("bloqueado"); }, setItem: () => { throw new Error("bloqueado"); } };
    const store = criarStoreTema(quebrado);
    expect(store.obter()).toBe("dark");
    store.definir("light");
    expect(store.obter()).toBe("light");
  });
  it("o script inicial (anti-flash) lê a mesma chave e só aceita light/dark", () => {
    expect(SCRIPT_TEMA_INICIAL).toContain(JSON.stringify(CHAVE_TEMA));
    const el = { dados: {} as Record<string, string>, setAttribute(k: string, v: string) { this.dados[k] = v; } };
    const rodar = (valor: string | null) => { el.dados = {}; new Function("localStorage", "document", SCRIPT_TEMA_INICIAL)({ getItem: () => valor }, { documentElement: el }); return el.dados["data-tema"]; };
    expect(rodar("light")).toBe("light");
    expect(rodar("dark")).toBe("dark");
    expect(rodar(null)).toBeUndefined();
    expect(rodar("x")).toBeUndefined();
  });
});

describe("nenhuma rota redefine o tema", () => {
  const raiz = join(process.cwd(), "src");
  const arquivos: string[] = [];
  const varrer = (dir: string) => readdirSync(dir).forEach((n) => { const p = join(dir, n); if (n === "__tests__" || n === "node_modules") return; if (statSync(p).isDirectory()) varrer(p); else if (/\.(tsx?|jsx?)$/.test(n)) arquivos.push(p); });
  varrer(raiz);
  it("nenhum componente guarda o tema em useState local nem fixa 'dark' como estado inicial", () => {
    const ruins = arquivos.filter((f) => /useState(<[^>]*>)?\(\s*["']dark["']\s*\)/.test(readFileSync(f, "utf8")));
    expect(ruins).toEqual([]);
  });
  it("toda página que usa THEMES[...] lê o tema do hook global (useTema)", () => {
    const comTheme = arquivos.filter((f) => /THEMES\[tema\]/.test(readFileSync(f, "utf8")) && /const \[tema, setTema\]/.test(readFileSync(f, "utf8")));
    expect(comTheme.length).toBeGreaterThan(10);
    comTheme.forEach((f) => expect(readFileSync(f, "utf8")).toContain("useTema()"));
  });
  it("o layout raiz aplica o script do tema e tolera a diferença de hidratação do atributo", () => {
    const l = readFileSync(join(raiz, "app", "layout.tsx"), "utf8");
    expect(l).toContain("SCRIPT_TEMA_INICIAL");
    expect(l).toContain("suppressHydrationWarning");
  });
});
