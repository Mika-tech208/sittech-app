// Mini-runner compatível com o subconjunto de vitest usado nos testes do projeto (o vitest real trava neste ambiente).
type Fn = () => unknown | Promise<unknown>;
interface Teste { nome: string; fn: Fn; antes: Fn[]; depois: Fn[] }
export const registro: Teste[] = [];
const pilhaNomes: string[] = [];
const pilhaAntes: Fn[][] = [[]];
const pilhaDepois: Fn[][] = [[]];
export function describe(nome: string, fn: () => void) {
  pilhaNomes.push(nome); pilhaAntes.push([...pilhaAntes[pilhaAntes.length - 1]]); pilhaDepois.push([...pilhaDepois[pilhaDepois.length - 1]]);
  try { fn(); } finally { pilhaNomes.pop(); pilhaAntes.pop(); pilhaDepois.pop(); }
}
export function it(nome: string, fn: Fn) { registro.push({ nome: [...pilhaNomes, nome].join(" › "), fn, antes: [...pilhaAntes[pilhaAntes.length - 1]], depois: [...pilhaDepois[pilhaDepois.length - 1]] }); }
export const test = it;
function formatar(nome: string, c: unknown): string {
  const args = Array.isArray(c) ? c : [c]; let i = 0;
  return nome.replace(/%[sdij]/g, () => { const v = args[i++]; return typeof v === "string" ? v : fmtSimples(v); }).replace(/\$(\w+)/g, (_m, k) => fmtSimples((c as Record<string, unknown>)?.[k]));
}
function fmtSimples(v: unknown) { try { return typeof v === "string" ? v : JSON.stringify(v); } catch { return String(v); } }
(it as unknown as { each: unknown }).each = (casos: unknown[]) => (nome: string, fn: (...a: unknown[]) => unknown) => { casos.forEach((c) => it(formatar(nome, c), () => fn(...(Array.isArray(c) ? c : [c])))); };
export function beforeEach(fn: Fn) { pilhaAntes[pilhaAntes.length - 1].push(fn); }
export function afterEach(fn: Fn) { pilhaDepois[pilhaDepois.length - 1].push(fn); }

function igual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  const ka = Object.keys(a as object).filter((k) => (a as Record<string, unknown>)[k] !== undefined);
  const kb = Object.keys(b as object).filter((k) => (b as Record<string, unknown>)[k] !== undefined);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => igual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}
function subconjunto(a: unknown, b: unknown): boolean {
  if (typeof b !== "object" || b === null) return Object.is(a, b);
  if (typeof a !== "object" || a === null) return false;
  if (Array.isArray(b)) return Array.isArray(a) && a.length === b.length && b.every((x, i) => subconjunto(a[i], x));
  return Object.keys(b as object).every((k) => subconjunto((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}
const fmt = (v: unknown) => { try { return JSON.stringify(v); } catch { return String(v); } };

function casaErro(err: unknown, msg: string, e: unknown): boolean {
  if (e === undefined) return true;
  if (typeof e === "string") return msg.includes(e);
  if (e instanceof RegExp) return e.test(msg);
  if (typeof e === "function") return err instanceof (e as new (...a: never[]) => unknown);
  if (typeof e === "object" && e !== null && "message" in (e as object)) return msg.includes(String((e as { message: unknown }).message));
  return false;
}
function matchers(r: unknown, negar: boolean) {
  const checa = (ok: boolean, msg: string) => { if (negar ? ok : !ok) throw new Error((negar ? "NÃO " : "") + msg); };
  return {
    toBe: (e: unknown) => checa(Object.is(r, e), `esperado ${fmt(e)} obteve ${fmt(r)}`),
    toEqual: (e: unknown) => checa(igual(r, e), `esperado ${fmt(e)} obteve ${fmt(r)}`),
    toMatchObject: (e: unknown) => checa(subconjunto(r, e), `esperado conter ${fmt(e)} obteve ${fmt(r)}`),
    toBeCloseTo: (e: number, d = 2) => checa(Math.abs((r as number) - e) < Math.pow(10, -d) / 2, `esperado ≈${e} obteve ${r}`),
    toHaveLength: (n: number) => checa((r as { length: number }).length === n, `esperado tamanho ${n} obteve ${(r as { length: number })?.length}`),
    toBeNull: () => checa(r === null, `esperado null obteve ${fmt(r)}`),
    toBeUndefined: () => checa(r === undefined, `esperado undefined obteve ${fmt(r)}`),
    toBeDefined: () => checa(r !== undefined, "esperado definido"),
    toBeTruthy: () => checa(Boolean(r), `esperado truthy obteve ${fmt(r)}`),
    toBeFalsy: () => checa(!r, `esperado falsy obteve ${fmt(r)}`),
    toBeGreaterThan: (e: number) => checa((r as number) > e, `esperado > ${e} obteve ${r}`),
    toBeGreaterThanOrEqual: (e: number) => checa((r as number) >= e, `esperado >= ${e} obteve ${r}`),
    toBeLessThan: (e: number) => checa((r as number) < e, `esperado < ${e} obteve ${r}`),
    toBeLessThanOrEqual: (e: number) => checa((r as number) <= e, `esperado <= ${e} obteve ${r}`),
    toContain: (e: unknown) => checa(typeof r === "string" ? r.includes(e as string) : Array.isArray(r) && r.some((x) => Object.is(x, e)), `esperado conter ${fmt(e)} em ${fmt(r)}`),
    toMatch: (e: RegExp | string) => checa(typeof e === "string" ? String(r).includes(e) : e.test(String(r)), `esperado casar ${e} com ${fmt(r)}`),
    toBeInstanceOf: (c: new (...a: never[]) => unknown) => checa(r instanceof c, "esperado instância"),
    toThrow: (e?: unknown) => {
      let lancou = false; let msg = ""; let err: unknown;
      try { (r as () => void)(); } catch (x) { lancou = true; err = x; msg = x instanceof Error ? x.message : String(x); }
      checa(lancou && casaErro(err, msg, e), `esperado lançar ${String(e ?? "")} (lançou: ${msg})`);
    },
    toHaveBeenCalled: () => checa(((r as { mock?: { calls: unknown[] } }).mock?.calls.length ?? 0) > 0, "esperado chamado"),
    toHaveBeenCalledTimes: (n: number) => checa(((r as { mock?: { calls: unknown[] } }).mock?.calls.length ?? 0) === n, `esperado ${n} chamadas`),
  };
}
export function expect(r: unknown) {
  const rejects = new Proxy({}, { get: (_t, k: string) => async (...a: unknown[]) => {
    let rejeitou = false; let erro: unknown;
    try { await (r as Promise<unknown>); } catch (x) { rejeitou = true; erro = x; }
    if (!rejeitou) throw new Error("esperado rejeitar, mas resolveu");
    if (k === "toThrow") { const msg = erro instanceof Error ? erro.message : String(erro); if (!casaErro(erro, msg, a[0])) throw new Error(`esperado rejeitar com ${String(a[0])} (rejeitou: ${msg})`); return; }
    return (matchers(erro, false) as Record<string, (...x: unknown[]) => unknown>)[k](...a);
  } });
  const resolves = new Proxy({}, { get: (_t, k: string) => async (...a: unknown[]) => { const v = await (r as Promise<unknown>); return (matchers(v, false) as Record<string, (...x: unknown[]) => unknown>)[k](...a); } });
  return { ...matchers(r, false), not: matchers(r, true), rejects, resolves };
}
export const vi = {
  fn: (impl?: (...a: unknown[]) => unknown) => { const f = ((...a: unknown[]) => { f.mock.calls.push(a); return impl?.(...a); }) as ((...a: unknown[]) => unknown) & { mock: { calls: unknown[][] } }; f.mock = { calls: [] }; return f; },
};
