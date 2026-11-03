/* eslint-disable @typescript-eslint/no-explicit-any */
// PARTE 1 — EMBALAGEM 17 EM M1: custo de oportunidade de cada candidato, validade física, contrafactual A (plano atual) / B (Emb17 forçada em M1, futuro intacto) / C (B + replanejamento de M2 em diante).
import * as fs from "node:fs";
import { montar, avaliar, visaoMotor, postosDe, chave, lerPlano, valorFinais, semPostoPorSlot, buscaLocal, despachar, linhasParaOcc, prepararDespacho, linhasComDetalhes, D14, type Ctx, type LinhaPostoD } from "./lib";
import { reatribuirPessoasBloco } from "@/features/escala/estabilidade";
import type { AlocacaoEscala } from "@/features/escala/types";

const c = montar(2400, `${D14}/plano-54c9.sql.out`);
const P1 = postosDe(c, lerPlano(`${D14}/plano-atual.sql.out`));
const plano1 = lerPlano(`${D14}/plano-atual.sql.out`);
const S = c.e.slots;
const sl = (t: number) => `${S[t].data.slice(8)}${S[t].periodoId.toUpperCase()}`;
const recId = (re: RegExp) => c.cfg.recursos.filter((r) => re.test(c.nm(r.id))).map((r) => r.id);
const EMB = recId(/^Embalagem 17/)[0], ETQ = recId(/^Etiquetadora 15/)[0];
const opEmb = c.e.operacaoDe(c.m.produtos.find((p: any) => p.id.startsWith("27c2")).id, c.m.produtos.find((p: any) => p.id.startsWith("27c2")).etapas[3].id);
const celulas = (A: LinhaPostoD[], B: LinhaPostoD[]) => { const f = (L: LinhaPostoD[]) => new Map(L.map((l) => [`${l.t}|${l.recursoId}`, l.operacaoId])); const a = f(A), b = f(B); let d = 0; new Set([...a.keys(), ...b.keys()]).forEach((k) => { if (a.get(k) !== b.get(k)) d++; }); return d; };
const nomeProd = (pid: string) => (pid.startsWith("27c2") ? "Conv" : pid.startsWith("a027") ? "Auto" : c.nome(pid).slice(0, 8));

console.log(`Embalagem 17 = ${c.nm(EMB)} (${EMB.slice(0, 8)}) op ${opEmb.slice(0, 6)} · Etiquetadora 15 = ${c.nm(ETQ)} · elegível/na Previsão: pool Embalar Conv máquinas ${JSON.stringify(c.m.poolPor.get(`${c.m.produtos.find((p: any) => p.id.startsWith("27c2")).id}|${c.m.produtos.find((p: any) => p.id.startsWith("27c2")).etapas[3].id}`)?.maquinasIds?.map((x: string) => c.nm(x)))} · unidades em M1: ${c.cfg.recursos.find((r) => r.id === EMB)!.unidades[0]}`);
const dA = avaliar(c, P1);
console.log(`A) plano atual: obj ${dA.obj.toFixed(1)} · estoque Etiquetar→Embalar no início de M1 (Conv) = ${dA.wip[c.m.produtos.find((p: any) => p.id.startsWith("27c2")).id][2][0]}`);

// --- custo de oportunidade: Emb17 em M1 no lugar de cada um dos 12 postos de M1
const M1 = P1.filter((p) => p.t === 0);
const linhasA = linhasComDetalhes(c.cfg, P1, dA);
const prodM1 = (p: LinhaPostoD) => { const x = linhasA.find((l) => l.linha.t === 0 && l.linha.recursoId === p.recursoId); return x ? x.detalhes.map((d) => `${nomeProd(d.produtoId)}${Math.round(d.pecas)}`).join("+") : "—"; };
const cand: any[] = [];
for (const p of M1) {
  const B = [...P1.filter((q) => chave(q) !== chave(p)), { t: 0, recursoId: EMB, operacaoId: opEmb }];
  const d = avaliar(c, B), v = valorFinais(c, d);
  const embM1 = linhasComDetalhes(c.cfg, B, d).filter((l) => l.linha.t === 0 && l.linha.recursoId === EMB).reduce((s, l) => s + l.detalhes.reduce((a, b) => a + b.pecas, 0), 0);
  cand.push({ sai: `${c.nm(p.recursoId)} (${prodM1(p)})`, dObj: d.obj - dA.obj, dFinais: v.total - valorFinais(c, dA).total, embM1: Math.round(embM1), obj: d.obj, B });
}
cand.sort((x, y) => y.dObj - x.dObj);
console.log("\nCUSTO DE OPORTUNIDADE — Embalagem 17 em M1 no lugar de cada posto de M1 (12 pessoas; futuro intacto):");
console.log("| posto de M1 que sairia (produção em M1) | Emb17 M1 (peças) | Δ objetivo | Δ peças finais da semana | Δ objetivo relativo | passa θ=1%? |");
console.log("|---|---:|---:|---:|---:|---|");
cand.forEach((x) => console.log(`| ${x.sai} | ${x.embM1} | ${x.dObj.toFixed(1)} | ${Math.round(x.dFinais)} | ${((x.dObj / dA.obj) * 100).toFixed(3)} % | ${x.dObj > dA.obj * 0.01 ? "SIM" : "não (precisaria > +" + (dA.obj * 0.01).toFixed(0) + ")"} |`));
const best = cand[0];
console.log(`\nMELHOR substituição: ${best.sai} → Δobj ${best.dObj.toFixed(1)} (${((best.dObj / dA.obj) * 100).toFixed(3)} %)`);

// --- métricas de um plano (conjunto de postos)
function resumo(rot: string, postos: LinhaPostoD[]) {
  const d = avaliar(c, postos), v = valorFinais(c, d), ld = linhasComDetalhes(c.cfg, postos, d);
  const prodMaq = (re: RegExp) => S.map((_, t) => Math.round(ld.filter((l) => l.linha.t === t && re.test(c.nm(l.linha.recursoId))).reduce((s, l) => s + l.detalhes.reduce((a, b) => a + b.pecas, 0), 0)));
  const conv = c.m.produtos.find((p: any) => p.id.startsWith("27c2")).id, aut = c.m.produtos.find((p: any) => p.id.startsWith("a027")).id;
  const wipC = d.wip[conv], wipA = d.wip[aut];
  const get = (a: number[] | undefined, t: number) => Math.round(a?.[t] ?? 0);
  const entradaEtq = S.map((_, t) => get(wipC[1], t) + get(wipA[0], t));
  const etqEmb = S.map((_, t) => get(wipC[2], t) + get(wipA[1], t));
  const etq = prodMaq(/^Etiquetadora 15/), emb = prodMaq(/^Embalagem 17/);
  const capE = S.map((s) => (s.periodoId.startsWith("m") ? 3500 : 3000)), capB = S.map((s) => (s.periodoId.startsWith("m") ? 5000 : 4500));
  const rup = (prod: number[], cap: number[], est: number[]) => { const i = prod.findIndex((x, k) => x < cap[k] - 1 && x >= est[k] - 1); return i < 0 ? "nenhuma" : sl(i); };
  const sp = semPostoPorSlot(c, postos).reduce((a, b) => a + b, 0);
  const out = {
    rot, obj: d.obj, finais: v.total, margem: v.margem, conv: v.porProd[conv], aut: v.porProd[aut], semPosto: sp, ociosas: d.linhasOciosas.length,
    rosq: prodMaq(/^Rosqueadeira/), paf9: prodMaq(/^Parafusadeira 9$/), paf12: prodMaq(/^Parafusadeira 12$/), m8: prodMaq(/^M8/), etq, emb, entradaEtq, etqEmb, wipRosq: S.map((_, t) => get(wipC[0], t)),
    rupEtq: rup(etq, capE, entradaEtq), rupEmb: rup(emb, capB, etqEmb), postos: postos.length,
  };
  return out;
}
const fmt = (a: number[], n = 8) => a.slice(0, n).join(",");
function imprime(r: any, ref: LinhaPostoD[], postos: LinhaPostoD[]) {
  console.log(`\n=== ${r.rot}: obj ${r.obj.toFixed(1)} · finais ${Math.round(r.finais)} (Conv ${Math.round(r.conv)} + Auto ${Math.round(r.aut)}) · margem R$ ${r.margem.toFixed(1)} · sem posto ${r.semPosto} · ociosas ${r.ociosas} · churn vs A ${celulas(ref, postos)} células · 1ª ruptura Etiq15 ${r.rupEtq} / Emb17 ${r.rupEmb}`);
  console.log(`  por período (1º–8º): Rosquear ${fmt(r.rosq)} | Parafusadeira 9 ${fmt(r.paf9)} | Parafusadeira 12 ${fmt(r.paf12)} | M8 ${fmt(r.m8)} | Etiq15 ${fmt(r.etq)} | Emb17 ${fmt(r.emb)}`);
  console.log(`  WIP início (1º–8º): Rosq→Paraf ${fmt(r.wipRosq)} | entrada Etiquetadora (Conv+M8) ${fmt(r.entradaEtq)} | Etiquetar→Embalar ${fmt(r.etqEmb)}`);
}
const rA = resumo("A) plano atual", P1);
imprime(rA, P1, P1);

// --- B: Emb17 em M1 no lugar do posto de menor custo; futuro intacto
const B = best.B as LinhaPostoD[];
const rB = resumo("B) Emb17 forçada em M1 (futuro intacto)", B);
imprime(rB, P1, B);

// --- C: M1 congelado (com Emb17) e replanejamento de M2 em diante (busca do motor, 150k, partindo do plano atual)
function replanejaFuturo(Bm1: LinhaPostoD[], semente: number) {
  const d0 = avaliar(c, Bm1);
  const cfg1: any = { ...c.cfg, t0: 1 };
  cfg1.produtos = c.cfg.produtos.map((p) => ({ ...p, wipInicial: d0.wip[p.id].map((l: number[]) => l[1]) }));
  cfg1.alvo = Object.fromEntries(c.cfg.produtos.map((p) => [p.id, Math.max(0, (c.cfg.alvo[p.id] ?? 0) - (d0.producao[p.id][p.etapas.length - 1][0] ?? 0))]));
  if (c.cfg.piso) cfg1.piso = Object.fromEntries(c.cfg.produtos.map((p) => [p.id, Math.max(0, (c.cfg.piso![p.id] ?? 0) - (d0.producao[p.id][p.etapas.length - 1][0] ?? 0))]));
  const D1 = prepararDespacho(cfg1);
  void D1;
  const fut = Bm1.filter((p) => p.t >= 1);
  const r = buscaLocal(cfg1, fut, { iter: 150000, reinicios: 1, semente });
  return [...Bm1.filter((p) => p.t === 0), ...r.linhas];
}
const rC: any[] = [];
for (const sem of [1, 2, 3]) {
  const Cc = replanejaFuturo(B, sem);
  const r = resumo(`C) B + replanejamento de M2 em diante (semente ${sem})`, Cc);
  rC.push({ r, Cc });
  imprime(r, P1, Cc);
}

// --- pessoas / revezamento / validade das hipóteses (A, B, C s1): atribuição por bloco com memória, ponte M3→T1
function pessoasEChecagens(rot: string, postos: LinhaPostoD[]) {
  const d = avaliar(c, postos), ld = linhasComDetalhes(c.cfg, postos, d);
  const porT = new Map<number, typeof ld>();
  ld.forEach((x) => (porT.get(x.linha.t) ?? porT.set(x.linha.t, []).get(x.linha.t)!).push(x));
  const lin: AlocacaoEscala[] = [];
  const ids = c.e.equipe.map((q: any) => q.id);
  for (let t = 0; t < S.length; t++) {
    const rs = porT.get(t) ?? [];
    ids.forEach((fid: string, i: number) => {
      const x = rs[i];
      const s = S[t];
      if (!x) lin.push({ data: s.data, periodoId: s.periodoId, funcionarioId: fid, maquinaId: null, produtoId: null, etapaId: null, operacaoId: null, pecas: 0, pecasAdicional: 0, motivoSemPosto: "sem posto", excecaoRevezamento: false, motivoExcecao: null, origem: "auto" } as any);
      else lin.push({ data: s.data, periodoId: s.periodoId, funcionarioId: fid, maquinaId: x.linha.recursoId, produtoId: x.detalhes[0]?.produtoId ?? null, etapaId: x.detalhes[0]?.etapaId ?? null, operacaoId: x.linha.operacaoId, pecas: x.detalhes.reduce((a, b) => a + b.pecas, 0), pecasAdicional: 0, motivoSemPosto: null, excecaoRevezamento: false, motivoExcecao: null, origem: "auto" } as any);
    });
  }
  const reg = reatribuirPessoasBloco(lin, [], S, { escopo: "bloco", ponteM3T1: true }, 600);
  const finais = reg?.linhas ?? lin;
  const dur = c.e.verificarDuras ? c.e.verificarDuras(finais) : null;
  const m1 = finais.filter((l) => l.periodoId === "m1" && l.data === S[0].data).map((l) => `${l.funcionarioId.slice(0, 4)}→${l.maquinaId ? c.nm(l.maquinaId) : "SEM POSTO"}`).sort();
  console.log(`\n${rot}: atribuição de pessoas por bloco ${reg ? "OK" : "FALHOU"} · violações duras (revezamento bloco + ponte M3→T1 + ausência + máquina) = ${dur} · M1: ${m1.join(" ; ")}`);
}
pessoasEChecagens("A", P1);
pessoasEChecagens("B", B);
pessoasEChecagens("C (semente 1)", rC[0].Cc);
fs.writeFileSync(`${D14}/parte1.json`, JSON.stringify({ cand: cand.map(({ B: _b, ...x }) => x), A: rA, B: rB, C: rC.map((x) => x.r) }, null, 1));
void despachar; void linhasParaOcc; void visaoMotor; void ETQ;
