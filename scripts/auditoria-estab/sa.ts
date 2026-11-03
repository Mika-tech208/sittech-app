/* eslint-disable @typescript-eslint/no-explicit-any */
// PROTÓTIPO OFFLINE (não é código de PROD): recozimento simulado IGUAL ao de postosDespacho.buscaLocal + PENALIDADE λ por célula (máquina×período) alterada em relação a um plano de referência.
// score = obj(despacho) − λ × nº de células (t, máquina) cuja operação difere da referência. λ=0 reproduz o motor (validado contra buscaLocal).
import { despachar, linhasParaOcc, occParaLinhas, restricoesOk, buscaLocal, type Ctx, type LinhaPostoD } from "./lib";

function prng(sem: number): () => number {
  let a = (sem + 0x9e3779b9) >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export interface ResSA { postos: LinhaPostoD[]; scoreBruto: number; celulasAlteradas: number }

export function saPenalizada(c: Ctx, inicial: LinhaPostoD[], referencia: LinhaPostoD[], lambda: number, op: { iter: number; semente: number; reinicios?: number }): ResSA {
  const C = c.cfg, D = c.D, R = C.recursos.length, H = D.H;
  const occRef = linhasParaOcc(C, D, referencia);
  let dist = 0;
  const celDiff = (occ: Uint8Array[], t: number, r: number) => (occ[t][r] !== occRef[t][r] ? 1 : 0);
  const occ0 = linhasParaOcc(C, D, inicial);
  for (let t = C.t0; t < H; t++) for (let r = 0; r < R; r++) dist += celDiff(occ0, t, r);
  const score = (occ: Uint8Array[], d: number) => despachar(C, D, occ).obj - lambda * d;
  let melhorOcc = occ0.map((x) => x.slice()), melhorScore = score(occ0, dist);
  const reinicios = op.reinicios ?? 1;
  for (let rr = 0; rr < reinicios; rr++) {
    const rnd = prng(op.semente + rr * 7919);
    const occ = melhorOcc.map((x) => x.slice());
    let d0 = 0;
    for (let t = C.t0; t < H; t++) for (let r = 0; r < R; r++) d0 += celDiff(occ, t, r);
    let cur = score(occ, d0), dCur = d0;
    const T0 = Math.max(5, Math.abs(cur) * 0.002), T1 = 0.05, n = Math.floor(op.iter / reinicios);
    for (let i = 0; i < n; i++) {
      const T = T0 * Math.pow(T1 / T0, i / n);
      const u = rnd();
      const undo: { t: number; r: number; v: number }[] = [];
      const set = (t: number, r: number, v: number) => { undo.push({ t, r, v: occ[t][r] }); occ[t][r] = v; };
      const tt = C.t0 + Math.floor(rnd() * (H - C.t0));
      const livre = (t: number, r: number) => occ[t][r] === 0 && (C.recursos[r].unidades[t] ?? 0) > 0;
      const sorteiaRec = () => Math.floor(rnd() * R);
      const sorteiaOp = (r: number) => { const l = D.opsDoRec[r]; return l.length ? l[Math.floor(rnd() * l.length)] + 1 : 0; };
      const tocados = new Set<number>();
      if (u < 0.25) { const r = sorteiaRec(), o = sorteiaOp(r); if (!o || !livre(tt, r)) continue; set(tt, r, o); tocados.add(tt); }
      else if (u < 0.40) { const r = sorteiaRec(); if (!occ[tt][r]) continue; set(tt, r, 0); tocados.add(tt); }
      else if (u < 0.55) { const r = sorteiaRec(); if (!occ[tt][r]) continue; const o = sorteiaOp(r); if (!o || o === occ[tt][r]) continue; set(tt, r, o); tocados.add(tt); }
      else if (u < 0.80) { const r = sorteiaRec(); if (!occ[tt][r]) continue; const t2 = C.t0 + Math.floor(rnd() * (H - C.t0)), r2 = rnd() < 0.5 ? r : sorteiaRec(); const o2 = r2 === r ? occ[tt][r] : sorteiaOp(r2); if (!o2 || !livre(t2, r2) || (t2 === tt && r2 === r)) continue; set(tt, r, 0); set(t2, r2, o2); tocados.add(tt); tocados.add(t2); }
      else { const r = sorteiaRec(); if (!occ[tt][r]) continue; const dd = (rnd() < 0.5 ? -1 : 1) * (1 + Math.floor(rnd() * 3)); const t2 = tt + dd; if (t2 < C.t0 || t2 >= H || !livre(t2, r)) continue; const o = occ[tt][r]; set(tt, r, 0); set(t2, r, o); tocados.add(tt); tocados.add(t2); }
      let ok = true;
      for (const t of tocados) if (!restricoesOk(C, D, occ, t)) { ok = false; break; }
      if (ok) {
        // distância nova: só as células tocadas mudam
        let dNova = dCur;
        const celulas = new Set(undo.map((x) => `${x.t}|${x.r}`));
        celulas.forEach((k) => { const [t, r] = k.split("|").map(Number); const antes = undo.find((x) => x.t === t && x.r === r)!.v; dNova += celDiff(occ, t, r) - (antes !== occRef[t][r] ? 1 : 0); });
        const nv = score(occ, dNova);
        const dlt = nv - cur;
        if (dlt >= 0 || rnd() < Math.exp(dlt / T)) {
          cur = nv; dCur = dNova;
          if (cur > melhorScore + 1e-9) { melhorScore = cur; melhorOcc = occ.map((x) => x.slice()); }
          continue;
        }
      }
      for (let k = undo.length - 1; k >= 0; k--) occ[undo[k].t][undo[k].r] = undo[k].v;
    }
  }
  const postos = occParaLinhas(C, D, melhorOcc);
  let cel = 0; for (let t = C.t0; t < H; t++) for (let r = 0; r < R; r++) cel += celDiff(melhorOcc, t, r);
  return { postos, scoreBruto: melhorScore, celulasAlteradas: cel };
}
export { buscaLocal };
